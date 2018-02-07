require([
    "jquery",
    "portal/portal",
    "portal/info",
    "portal/util",
    "mustache",
    "nprogress",
    "esri/arcgis/Portal",
    "esri/arcgis/OAuthInfo",
    "esri/IdentityManager",
    "highlight",
    "typeahead",
    "select2",
    "jquery.ui",
    "bootstrap-shim"
], function(
    jquery,
    portalSelf,
    portalInfo,
    portalUtil,
    mustache,
    NProgress,
    arcgisPortal,
    arcgisOAuthInfo,
    esriId,
    hljs
) {

    // *** ArcGIS OAuth ***
    var appInfo = new arcgisOAuthInfo({
        appId: "hjnuzGHOZB0mlcvt",
        //appId: "4E1s0Mv5r0c2l6W8",
        popup: true,
        portalUrl: "https://www.arcgis.com/"
    });

    // Some app level variables.
    var app = {
        hideArcGISOnline: true,
        copyWarning: true,
        copyWarningText: "<p><strong>Warning:</strong> You are responsible for ensuring the destination Portal is approved to hold the type of data you are copying.</p>",
        maxSearchResults: 500,
        stats: {
            activities: {}
        },
        portals: {
            arcgisOnline: new portalSelf.Portal({
                portalUrl: "https://www.arcgis.com/"
            })
        }
    };

    /**
     * Check the url for errors (e.g. no trailing slash)
     * and update it before sending.
     */
    var validateUrl = function(el, portal) {
        "use strict";
        var inputUrl = jquery.trim(jquery(el).val());

        portalUtil.fixUrl(inputUrl).done(function(portalUrl) {
            jquery(el).val(portalUrl);
            var urlError = jquery("#urlErrorTemplate").html();
            var checkbox = jquery(el).parent().parent()
                .find("input[type='checkbox']");
            jquery(el).parent().removeClass("has-error");
            jquery(el).next().removeClass("glyphicon-ok");

            portal.portalUrl = portalUrl;
            portal.version()
                .done(function(data) {
                    console.log("API v" + data.currentVersion);
                    jquery(".alert-danger.alert-dismissable").remove();
                    jquery(el).next().addClass("glyphicon-ok");
                })
                .fail(function() {
                    // Try it again with enterprise auth.
                    portal.withCredentials = true;
                    portal.version()
                        .done(function(data) {
                            console.log("API v" + data.currentVersion);
                            jquery(".alert-danger.alert-dismissable").remove();
                            jquery(el).next().addClass("glyphicon-ok");
                            jquery(checkbox).trigger("click");
                        })
                        .fail(function() {
                            // Now try enterprise auth with jsonp so crossdomain will follow redirects.
                            portal.jsonp = true;
                            portal.version().done(function(data) {
                                // It worked so keep enterprise auth but turn jsonp back off.
                                portal.jsonp = false;
                                console.log("API v" + data.currentVersion);
                                jquery(".alert-danger.alert-dismissable").remove();
                                jquery(el).next().addClass("glyphicon-ok");
                            }).fail(function(xhr, textStatus) {
                                // OK, it's really not working.
                                console.log(xhr, textStatus);
                                portal.withCredentials = false;
                                portal.jsonp = false;
                                jquery(".alert-danger.alert-dismissable").remove();
                                jquery(el).parent().parent().after(urlError);
                                jquery(el).parent().addClass("has-error");
                            });
                        });
                });
        });
    };

    var startSession = function() {
        "use strict";
        var searchHtml;
        app.portals.sourcePortal.self().done(function(data) {
            var template = jquery("#sessionTemplate").html();
            var html = mustache.to_html(template, data);
            app.portalSelfData = data;
            app.portals.sourcePortal.username = data.user.username;
            app.portals.sourcePortal.portalUrl = "https://" + data.portalHostname + "/";
            jquery(".nav.navbar-nav").after(html);
            jquery("#logout").show();
            jquery("#actionDropdown").css({
                visibility: "visible"
            });
            searchHtml = mustache.to_html(jquery("#searchTemplate").html(), {
                portal: app.portals.sourcePortal.portalUrl,
                name: data.name,
                id: data.id
            });
            jquery("#actionDropdown").before(searchHtml);

            // Add a listener for clicking the search icon.
            // Fix me.
            jquery(document).on("click", "i.glyphicon-search", function() {
                search();
            });

            // Add a listener for the enter key on the search form.
            jquery("#searchForm").keypress(function(e) {
                if (e.which == 13) {
                    search();
                }
            });

            NProgress.start();
            listUserItems();
            NProgress.done();
        });
    };

    var loginPortal = function() {
        var username = jquery("#portalUsername").val();
        var password = jquery("#portalPassword").val();
        jquery("#portalLoginBtn").button("loading");
        app.portals.sourcePortal.generateToken(username, password)
            .done(function(response) {
                if (response.token) {
                    app.portals.sourcePortal.token = response.token;
                    jquery("#portalLoginModal").modal("hide");
                    jquery("#splashContainer").css("display", "none");
                    jquery("#itemsContainer").css("display", "block");
                    startSession();
                } else if (response.error.code === 400) {
                    var html = jquery("#loginErrorTemplate").html();
                    jquery(".alert-danger.alert-dismissable").remove();
                    jquery("#portalLoginForm").before(html);
                }
            })
            .fail(function(response) {
                console.log(response.statusText);
                var html = jquery("#loginErrorTemplate").html();
                jquery(".alert-danger.alert-dismissable").remove();
                jquery("#portalLoginForm").before(html);
            })
            .always(function() {
                jquery("#portalLoginBtn").button("reset");
            });
    };

    var loginDestination = function() {
        var username = jquery("#destinationUsername").val();
        var password = jquery("#destinationPassword").val();
        var portalUrl = jquery("#destinationUrl").val();

        if (!app.portals.destinationPortal) {
            app.portals.destinationPortal = new portalSelf.Portal({
                portalUrl: portalUrl
            });
        }

        jquery("#destinationLoginBtn").button("loading");
        jquery("#dropArea").empty();
        app.portals.destinationPortal.generateToken(username, password)
            .done(function(response) {
                if (response.token) {
                    app.portals.destinationPortal.token = response.token;
                    app.portals.destinationPortal.self().done(function(data) {
                        if (data.error) {
                            console.error("Error in response:", data); // TODO: make this error display in the originating dialog
                        } else {
                            app.portals.destinationPortal.username = data.user.username;
                            app.portals.destinationPortal.portalUrl = "https://" +
                            data.portalHostname + "/";
                            jquery("#copyModal").modal("hide");
                            highlightCopyableContent();
                            NProgress.start();
                            showDestinationFolders();
                            NProgress.done();
                        }
                    });
                } else if (response.error.code === 400) {
                    var html = jquery("#loginErrorTemplate").html();
                    jquery(".alert-danger.alert-dismissable").remove();
                    jquery("#destinationLoginForm").before(html);
                }
            })
            .fail(function(response) {
                console.log(response.statusText);
                var html = jquery("#loginErrorTemplate").html();
                jquery(".alert-danger.alert-dismissable").remove();
                jquery("#destinationLoginForm").before(html);
            })
            .always(function() {
                jquery("#destinationLoginBtn").button("reset");
            });
    };

    var logout = function() {
        sessionStorage.clear();
        app.stats.activities = {};
        jquery("#actionDropdown li").removeClass("active");
        jquery("#itemsArea").empty();
        jquery("#dropArea").empty();
        jquery("#sessionDropdown").remove();
        jquery("#searchForm").remove();
        jquery("#actionDropdown").css({
            visibility: "hidden"
        });
        esriId.destroyCredentials();
        delete app.portals.sourcePortal;
        delete app.portals.destinationPortal;
        window.location.reload();
    };

    var search = function() {

        var query = jquery("#searchText").val();
        var portalUrl = jquery("#searchMenu li.active").attr("data-url");
        var portal;

        // Add the org id for "My Portal" searches.
        if (jquery("#searchMenu li.active").attr("data-id")) {
            query += " accountid:" +
                jquery("#searchMenu li.active").attr("data-id");
        }

        // Add the username for "My Content" searches.
        if (jquery("#searchMenu li.active").text() === "Search My Content") {
            query += " owner:" + app.portals.sourcePortal.username;
        }

        /**
         * Prevent trying to pass a portal token when
         * searching ArcGIS Online.
         */
        if (portalUrl === "https://www.arcgis.com/" &&
            portalUrl !== app.portals.sourcePortal.portalUrl) {
            portal = app.portals.arcgisOnline;
        } else {
            portal = app.portals.sourcePortal;
        }

        NProgress.start();
        portal.search(query, 100, "numViews", "desc")
            .done(function(results) {
                listSearchItems(portal.portalUrl, results);
                NProgress.done();
            });
    };

    var searchAdvanced = function() {
        "use strict";

        var searchField = jquery("#filterAttributeInput").val();
        var searchOperator = jquery("#filterOpInput").val();
        var searchValue = jquery("#searchValue").val();
        var searchLocation = jquery("#advancedSearchModal .advanced-search-location.active").attr("data-action");
        var searchType = jquery("#advancedSearchModal .advanced-search-type.active").attr("data-action");

        var portalUrl = jquery("#searchMenu li.active").attr("data-url");
        var portal;

        // Log warnings for seach types that aren't supported fully
        if (searchType !== "items") {
            if (searchType === "groups") {
                console.warn("Searching groups is not fully implemented yet. Doing a title search is valid for group titles.");
            } else if( searchType === "users") {
                console.warn("Searching users is not fully implemented yet. Doing a title search will search the username field.");
            }
        }

        var filterArray = [], attributesFilteredMap = {}, conjunctionTerm = null;

        var allQueryFilterEl = jquery("#queryBody [data-filterdefinition]");
        jquery.each(allQueryFilterEl, function(el, index) {
            var filter = jquery(this).attr("data-filterdefinition");
            var filterAttribute = jquery(this).attr("data-filterattribute");
            var filterOperator = jquery(this).attr("data-filteroperator");
            var filterValue = jquery(this).attr("data-filtervalue");

            // Compose filter definition
            var filterdefinition = composeFilter(searchLocation, searchType, searchField, searchOperator, searchValue);

            if (filter === "compound") {
                // skip compound filter types
            } else if (filter === "OR" || filter === "AND") {
                conjunctionTerm = filter;
            } else {
                var existing = attributesFilteredMap[filterAttribute];
                var appendedFilter;
                if (existing) {
                    // For tag attribute filters use whatever conjunction term that was specified
                    if (filterAttribute === "Tag" && conjunctionTerm) {
                        filter = existing + " " + conjunctionTerm + " " + filter;
                    } else {
                        filter = existing + " OR " + filter;
                    }
                    // Reset any conjunction term
                    conjunctionTerm = null;
                }
                attributesFilteredMap[filterAttribute] = filter;
            }
        });

        // Compose array of each attribute's query and then join with an AND relationship.
        jquery.each(attributesFilteredMap, function(filterAttribute) {
            if (attributesFilteredMap.hasOwnProperty(filterAttribute)) {
                filterArray.push("(" + attributesFilteredMap[filterAttribute] + ")");
            }
        });
        var query = filterArray.join(" AND ");

        // TODO: add this back in and test for ArcGIS Online environments
        // /**
        //  * Prevent trying to pass a portal token when
        //  * searching ArcGIS Online.
        //  */
        // if (portalUrl === "https://www.arcgis.com/" &&
        //     portalUrl !== app.portals.sourcePortal.portalUrl) {
        //     portal = app.portals.arcgisOnline;
        // } else {
        //     portal = app.portals.sourcePortal;
        // }

        portal = app.portals.sourcePortal;

        NProgress.start();
        if (searchType === "users") {
            portal.searchUsers(query, app.maxSearchResults, "username", "desc").done(function(results) {
                listSearchUsers(portal.portalUrl, results);
                NProgress.done();
            });
        } else if (searchType === "groups") {
            portal.searchGroups(query, app.maxSearchResults, "title", "desc").done(function(results) {
                listSearchGroups(portal.portalUrl, results);
                NProgress.done();
            });
        } else {
            portal.pagingSearch(query, "numViews", "desc", app.maxSearchResults).done(function(results) {
                console.debug("results:", results);
                listSearchItems(portal.portalUrl, results);
                NProgress.done();
            });
/*            portal.search(query, app.maxSearchResults, "numViews", "desc").done(function(results) {
                listSearchItems(portal.portalUrl, results);
                NProgress.done();
            });*/
        }
    };

    var inspectContent = function() {
        "use strict";

        var portal;
        var jsonBackup;
        var jsonValid;

        var validateJson = function(jsonString) {
            try {
                var o = JSON.parse(jsonString);
                if (o && typeof o === "object" && o !== null) {
                    return o;
                }
            } catch (e) {}

            return false;
        };

        var startEditing = function(e) {

            // Allow removing the button active state.
            e.stopImmediatePropagation();

            var codeBlock = jquery(e.currentTarget)
                .parent()
                .next();
            var editButton = jquery(e.currentTarget);
            var saveButton = jquery(e.currentTarget)
                .parent()
                .children("[data-action='saveEdits']");

            // Reset the save button.
            saveButton
                .children("span")
                .attr("class", "fa fa-lg fa-save");

            if (codeBlock.attr("contentEditable") !== "true") {
                // Start editing.
                editButton
                    .children("span")
                    .attr("class", "fa fa-lg fa-undo");
                editButton.attr("data-toggle", "tooltip");
                editButton.attr("data-placement", "bottom");
                editButton.attr("title", "Discard your edits");
                editButton.tooltip();
                jsonBackup = codeBlock.text();
                codeBlock.attr("contentEditable", "true");
                codeBlock.bind("input", function() {
                    // Validate the JSON as it is edited.
                    jsonValid = validateJson(codeBlock.text());
                    saveButton.tooltip("destroy");
                    if (jsonValid) {
                        // Valid. Allow saving.
                        saveButton.removeClass("disabled");
                        saveButton.css("color", "green");
                        saveButton.attr("data-toggle", "tooltip");
                        saveButton.attr("data-placement", "bottom");
                        saveButton.attr("title",
                            "JSON is valid. Click to save."
                        );
                    } else {
                        // Invalid. Prevent saving.
                        saveButton.css("color", "red");
                        saveButton.attr("data-toggle", "tooltip");
                        saveButton.attr("data-placement", "bottom");
                        saveButton.attr("title",
                            "JSON is invalid. Saving not allowed."
                        );
                    }

                    saveButton.tooltip({
                        container: "body"
                    });
                });

                editButton.attr("class", "btn btn-default");
                saveButton.attr("class", "btn btn-default");
            } else {
                // Let the user back out of editing without saving.
                // End editing and restore the original json.
                codeBlock.attr("contentEditable", "false");
                codeBlock.text(jsonBackup);
                codeBlock.each(function(i, e) {
                    hljs.highlightBlock(e);
                });

                editButton.attr("class", "btn btn-default");
                editButton.children("span")
                    .attr("class", "fa fa-lg fa-pencil");
                editButton.tooltip("destroy");
                saveButton.attr("class", "btn btn-default disabled");
                saveButton.css("color", "black");
            }

            // Post the edited JSON.
            saveButton.click(function() {
                if (jsonValid) {
                    // JSON is valid. Allow saving.
                    var newJson = codeBlock.text();
                    var itemInfo = JSON.parse(
                        jquery("#descriptionJson").text()
                    );
                    editButton.attr("class", "btn btn-default");
                    editButton.children("span")
                        .attr("class", "fa fa-lg fa-pencil");
                    saveButton.attr("class",
                        "btn btn-default disabled"
                    );
                    saveButton.css("color", "black");
                    codeBlock.attr("contentEditable", "false");

                    // Post the changes.
                    saveButton.children("span")
                        .attr("class", "fa fa-lg fa-spinner fa-spin");
                    var ownerFolder;
                    if (itemInfo.ownerFolder) {
                        ownerFolder = itemInfo.ownerFolder;
                    } else {
                        ownerFolder = "/";
                    }

                    if (editButton.attr("data-container") === "Description") {
                        portal.updateDescription(itemInfo.owner, itemInfo.id, ownerFolder, newJson).done(function(response) {
                            if (response.success) {
                                saveButton.children("span").attr("class", "fa fa-lg fa-check");
                                saveButton.css("color", "green");
                            } else {
                                saveButton.children("span").attr("class", "fa fa-lg fa-times");
                                saveButton.css("color", "red");
                            }
                        });
                    } else if (editButton.attr("data-container") === "Data") {
                        saveButton.children("span").attr("class", "fa fa-lg fa-spinner fa-spin");
                        portal.updateData(itemInfo.owner, itemInfo.id, ownerFolder, newJson).done(function(response) {
                            if (response.success) {
                                saveButton.children("span").attr("class", "fa fa-lg fa-check");
                                saveButton.css("color", "green");
                            } else {
                                saveButton.children("span").attr("class", "fa fa-lg fa-times");
                                saveButton.css("color", "red");
                            }
                        });
                    }
                } else {
                    saveButton.removeClass("active");
                }
            });
        };

        jquery(".content").addClass("data-toggle");
        jquery(".content").removeAttr("disabled");
        jquery(".content").attr("data-toggle", "button");
        jquery(".content").addClass("btn-info");

        jquery("#inspectModal").modal("hide");
        jquery("#inspectBtn").button("reset");

        // Add a listener for clicking on content buttons.
        jquery(".content").click(function() {
            var server = jquery(this).attr("data-portal");
            var id = jquery(this).attr("data-id");
            var datatype = jquery(this).attr("data-type");
            var title = jquery(this).text();
            var itemData, userData, groupData;

            /**
             * Prevent trying to pass a portal token when
             * inspecting content from an ArcGIS Online search.
             */
            if (server === "https://www.arcgis.com/" &&
                server !== app.portals.sourcePortal.portalUrl) {
                portal = app.portals.arcgisOnline;
            } else {
                portal = app.portals.sourcePortal;
            }

            NProgress.start();
            jquery(".content").addClass("btn-info");
            jquery(".content").removeClass("active");
            jquery(".content").removeClass("btn-primary");
            jquery(this).addClass("btn-primary");
            jquery(this).removeClass("btn-info");

            if (datatype === "User") {
                portal.userProfile(id)
                    .done(function(data) {
                        userData = data;
                    }).always(function() {
                            var templateData = {
                                title: title,
                                url: portal.portalUrl,
                                id: id,
                                description: JSON.stringify(
                                    id, undefined, 2
                                ),
                                data: JSON.stringify(
                                    userData, undefined, 2
                                )
                            };

                            var html = mustache.to_html(
                                jquery("#inspectUserTemplate").html(),
                                templateData
                            );

                            // Add the HTML container with the JSON.
                            jquery("#dropArea").html(html);

                            NProgress.done();
                    });

            } else if (datatype === "Group") {
                portal.groupInfo(id)
                    .done(function(data) {
                        groupData = data;
                    }).always(function() {
                            var templateData = {
                                title: title,
                                url: portal.portalUrl,
                                id: id,
                                description: JSON.stringify(
                                    id, undefined, 2
                                ),
                                data: JSON.stringify(
                                    groupData, undefined, 2
                                )
                            };

                            var html = mustache.to_html(
                                jquery("#inspectUserTemplate").html(),
                                templateData
                            );

                            // Add the HTML container with the JSON.
                            jquery("#dropArea").html(html);

                            NProgress.done();
                    });
            } else {
            portal.itemDescriptions(id)
                .done(function(description) {
                    portal.itemData(id)
                        .done(function(data) {
                            itemData = data;
                        })
                        .always(function() {
                            var templateData = {
                                title: title,
                                url: portal.portalUrl,
                                id: id,
                                description: JSON.stringify(
                                    description, undefined, 2
                                ),
                                data: JSON.stringify(
                                    itemData, undefined, 2
                                )
                            };

                            // Add a download link for files.
                            if (templateData.data === undefined &&
                                description.typeKeywords
                                .indexOf("Service") === -1) {
                                templateData
                                    .downloadLink = portal.portalUrl +
                                    "sharing/rest/content/items/" +
                                    id +
                                    "/data?token=" + portal.token;
                            }

                            var html = mustache.to_html(
                                jquery("#inspectTemplate").html(),
                                templateData
                            );

                            // Add the HTML container with the JSON.
                            jquery("#dropArea").html(html);
                            /**
                             * Color code the JSON to make it easier
                             * to read (uses highlight.js).
                             */
                            jquery("pre").each(function(i, e) {
                                hljs.highlightBlock(e);
                            });

                            jquery(".btn-default[data-action='startEdits']").click(function(e) {
                                if (!localStorage.hasOwnProperty("editsAllowed")) {
                                    // Show the caution modal.
                                    var editJsonBtn = jquery("#editJsonBtn");
                                    jquery("#editJsonModal").modal("show");
                                    jquery(".acknowledgeRisk").click(function(e) {
                                        if (jquery(e.currentTarget).prop("checked")) {
                                            editJsonBtn.removeClass("disabled");
                                        } else {
                                            editJsonBtn.addClass("disabled");
                                        }
                                    });
                                } else {
                                    startEditing(e);
                                }

                                jquery("#editJsonBtn").click(function() {
                                    jquery("#editJsonModal").modal("hide");
                                    localStorage.setItem("editsAllowed", true);
                                    startEditing(e);
                                });

                            });

                            NProgress.done();
                        });
                });
            }
        });
    };

    var testRegisteredServices = function() {
        console.debug("testRegisteredServices running");

        var template = jquery("#testRegisteredServicesTemplate").html();
        var html = mustache.to_html(template, {});

        // Add the HTML container with the item JSON.
        jquery("#dropArea").html(html);

        // Add a listener for the copy warning button.
        jquery(document).on("click", ".serviceTestFilter", function(e) {
            var btn = jquery(this);
            jquery(".serviceTestFilter").removeClass("btn-primary active");
            btn.addClass("btn-primary active");
        });

        // Event listener for verifying the services
        jquery("#btnVerifyServices").click(function() {
            console.debug("verifying services");
            console.debug("app.portalSelfData:", app.portalSelfData);

            var testAll = false;
            var testCase = jquery(".serviceTestFilter.btn-primary.active").attr("data-action");
            if (testCase === "test-all") {
                testAll = true;
            }

            // Hide the export test results button
            //jquery("#exportTestResultsSection").css("display", "none");

            var serviceTests = [];

            var portal =app.portals.sourcePortal;

            var testingStatusPane = jquery("#testServicesResultsPane");
            testingStatusPane.text("Running discovery of services to test...");

            // Search for all web maps
            NProgress.start();

// accountid:6R2vgvKf412BgI7w access:private type:service -type:"service definition" -typekeywords:tool
/// accountid:6R2vgvKf412BgI7w access:org type:"web map" -type:"web mapping application"

            //var queryString = "(type:\"Web Map\" OR type:\"Feature Service\" OR type:\"Map Service\" OR type:\"Image Service\" OR type:\"KML\" OR type:\"WMS\" OR type:\"Web Mapping Application\" OR type:\"Mobile Application\" OR type:\"Web Mapping Application\")";
            //var queryString = "accountid:6R2vgvKf412BgI7w type:\"web map\" -type:\"web mapping application\"";
            //var queryString = "accountid:6R2vgvKf412BgI7w"; // This is the orgId in AGO (is this correct in portal? Portal does show an orgid in the Self call return)

            //var queryString = "accountid:" + app.portalSelfData.user.orgId;
            var queryString = "accountid:" + app.portalSelfData.user.orgId + " (type:\"Feature Service\" OR type:\"Map Service\" OR type:\"Image Service\" OR type:\"KML\" OR type:\"WMS\")";
            if (testAll) {
                queryString = "accountid:" + app.portalSelfData.user.orgId + " (type:\"Web Map\" OR type:\"Feature Service\" OR type:\"Map Service\" OR type:\"Image Service\" OR type:\"KML\" OR type:\"WMS\")";
            }

            console.debug("The initial query for services to test is '" + queryString + "'");

            console.debug("queryString:", queryString);

            // Types to find: Web Map, Feature Service, Map Service, Image Service, KML, WMS, Web Mapping Application, Mobile Application, 
            // Types that are optional: Pro Map, Geodata Service, Globe Service, Geometry Service, Geocoding Service, Network Analysis Service, Geoprocessing Service, Workflow Manager Service, Operation View, Native Application, Map Document, Globe Document, Scene Document, Pro Map, Layer, Geoprocessing Package, 
            portal.pagingSearch(queryString, "numViews", "desc")
                .done(function(response) {
                    console.debug("the paging search for items has returned to main.js");
                    console.debug("main.js results from paging search : ", response);
                    console.debug("total response.results array: ", response.results);
                    console.debug("total response.results array lenght: ", response.results.length);

                    var urlTests = [];
                    var webmapOpLayerCount = 0;
                    var typeCounts = {
                        "Web Map": 0,
                        "Feature Service": 0,
                        "Map Service": 0,
                        "Web Mapping Application": 0
                    };

                    var testsDf = new jquery.Deferred();
                    var webMapDefers = [];
                    for (var i = 0; i < response.results.length; i++) {
                        var itemInfo = response.results[i];
                        console.debug("itemInfo " + i + ": ", itemInfo);
                        typeCounts[itemInfo.type] = typeCounts[itemInfo.type] + 1;

                        if (itemInfo.type === "Web Map") {
                            //urlTests.push({"url": itemInfo.url, "itemInfo": itemInfo});
                            console.debug("Web map item data item:", itemInfo);
                            
                            var requestDf = portal.itemData(itemInfo.id);
                            webMapDefers.push(requestDf);
                            requestDf.done(function(response) {
                                console.debug("web map description: ", response);

                                if (response && response.operationalLayers) {
                                    for (var j = 0; j < response.operationalLayers.length; j++) {
                                        var operationalLayerInfo = response.operationalLayers[j];
                                        console.debug("Web map contained operational layer:", operationalLayerInfo);
                                        console.debug("web map operational layer layerType: ", operationalLayerInfo.layerType);
                                        
                                        if (operationalLayerInfo.layerType && operationalLayerInfo.layerType !== "ArcGISFeatureLayer") {
                                            console.debug("operationallayer has type but is not ArcGISFeatureLayer. value is: " + operationalLayerInfo.layerType);
                                        }
                                        if (operationalLayerInfo && operationalLayerInfo.url) {
                                                urlTests.push({"url": operationalLayerInfo.url, "itemInfo": itemInfo});
                                                webmapOpLayerCount = webmapOpLayerCount + 1;
                                        }
                                    }
                                }
                            });
                        } else if (itemInfo.type === "Feature Service") {
                            urlTests.push({"url": itemInfo.url, "itemInfo": itemInfo});

                        } else if (itemInfo.type === "Map Service") {
                            urlTests.push({"url": itemInfo.url, "itemInfo": itemInfo});

                        } else if (itemInfo.type === "Image Service") {
                            urlTests.push({"url": itemInfo.url, "itemInfo": itemInfo});

                        }else if (itemInfo.type === "Web Mapping Application") {
                            console.debug("Web Mapping Application found: ", itemInfo);
                            //urlTests.push({"url": itemInfo.url, "itemInfo": itemInfo});
                        } else {
                            // Other types not currently handled: "Feature Collection", "Operation View", "KML", "CSV", "Code Sample", "Service Definition", "PDF", "Layer Package", "Code Attachment", "Map Package", "Shapefile", "Workforce Project"
                            console.debug("Unknown type of entry found: ", itemInfo);
                        }
                    }

                    if (webMapDefers.length > 0) {
                        jquery.when.apply(jquery, webMapDefers).then(function(results) {
                            testsDf.resolve({});
                        }, function(error) {
                            console.error("Error: ", error);
                            testsDf.resolve(error);
                        });
                    } else {
                        testsDf.resolve({});
                    }
                    

                    testsDf.done(function(results){
                        console.debug("The composed tests to run are complete. Proceeding to run tests.");

                        console.debug("typeCounts:", typeCounts);
                        console.debug("urlTests:", urlTests);

                        testingStatusPane.append("<br />Discovered " + urlTests.length + " tests to run.<br />");
                        testingStatusPane.append(webmapOpLayerCount + " layers come from within Web Maps.<br />");
                        testingStatusPane.append("Running service tests... this may take a bit...<br />");

                        portal.testServiceStatuses(urlTests)
                            .done(function(response) {
                                NProgress.done();
                                console.debug("Completed service testing");

                                //jquery("#exportTestResultsSection").css("display", "block");
                                console.debug("results here: ", response);
                                testingStatusPane.append("<br />Tests Completed.<br />");
                                testingStatusPane.append("Success: " + response.successServices.length);
                                testingStatusPane.append(". Error: " + response.errorServices.length);

                                var k = 0, exportRows = [], itemInfo;
                                exportRows.push(["Success",null,null,null,null,null,null,null,null,null,null]);
                                exportRows.push(["Title", "Owner", "Id", "Originating Item Type", "Success Url", "Created", "Modified", "Number of Views"]);

                                // loop over the success services
                                for (k = 0; k < response.successServices.length; k++) {
                                    var successService = response.successServices[k];
                                    itemInfo = successService.itemInfo;
                                    console.debug("successService: ", successService);
                                    exportRows.push([itemInfo.title, itemInfo.owner, itemInfo.id, itemInfo.type, successService.url, formatDate(new Date(itemInfo.created)), formatDate(new Date(itemInfo.modified)), itemInfo.numViews]);
                                }

                                exportRows.push([null,null,null,null,null,null,null,null,null,null,null]);
                                exportRows.push(["Failure",null,null,null,null,null,null,null,null,null,null]);
                                exportRows.push(["Title", "Owner", "Id", "Originating Item Type", "Failure Url", "Created", "Modified", "Number of Views"]);

                                // loop over the success services
                                for (k = 0; k < response.errorServices.length; k++) {
                                    var errorService = response.errorServices[k];
                                    itemInfo = errorService.itemInfo;
                                    console.debug("errorService: ", errorService);
                                    exportRows.push([itemInfo.title, itemInfo.owner, itemInfo.id, itemInfo.type, errorService.url, formatDate(new Date(itemInfo.created)), formatDate(new Date(itemInfo.modified)), itemInfo.numViews]);
                                }

                                var today = new Date();
                                var dd = today.getDate();
                                var mm = today.getMonth()+1; //January is 0!

                                if(dd<10) {
                                    dd='0'+dd;
                                } 

                                if(mm<10) {
                                    mm='0'+mm;
                                } 

                                today = mm+'/'+dd+'/'+today.getFullYear();

                                exportToCsv("ArcGIS Online Assistant Service Test Results " + today + ".csv", exportRows);


                        });
                    });

/*                  
                        portal.search("(type:\"Web Map\" OR type:\"Feature Service\" OR type:\"Map Service\" OR type:\"Image Service\" OR type:\"KML\" OR type:\"WMS\" OR type:\"Web Mapping Application\" OR type:\"Mobile Application\" OR type:\"Web Mapping Application\")", 100, "numViews", "desc", offset)
                            .then(function(moreResults) {
                    }*/
            });
        });
    };

    var updateWebmapServices = function() {
        "use strict";

        var webmapData;
        var owner;
        var folder;
        var supportedContent = jquery.merge(
            jquery(".content[data-type='Web Map']"),
            jquery(".content[data-type='Web Scene']")
        );
        var portal = app.portals.sourcePortal;

        // Highlight supported content.
        supportedContent.addClass("data-toggle btn-info");
        supportedContent.removeAttr("disabled");
        supportedContent.attr("data-toggle", "button");

        // Add a listener for clicking on content buttons.
        jquery(".content").click(function() {
            // Display the selected Web Map's operational layers.
            var id = jquery(this).attr("data-id");
            var webmapTitle = jquery(this).text();
            jquery(".content[data-type='Web Map']").addClass("btn-info");
            jquery(".content").removeClass("active");
            jquery(".content").removeClass("btn-primary");
            jquery(this).addClass("btn-primary");
            jquery(this).removeClass("btn-info");

            // TODO: this toggles off other items and needs to change for multiple selection
            portal.itemDescriptions(id)
                .done(function(description) {
                    owner = description.owner;
                    if (!description.ownerFolder) {
                        // Handle content in the user's root folder.
                        folder = "";
                    } else {
                        folder = description.ownerFolder;
                    }
                });

            portal.itemData(id)
                .done(function(data) {
                    webmapData = JSON.stringify(data);
                    var operationalLayers = [];
                    jquery.each(data.operationalLayers, function(layer) {
                        if (data.operationalLayers[layer].hasOwnProperty("url")) {
                            operationalLayers.push(data.operationalLayers[layer]);
                        }
                    });

                    var tables = [];
                    if (data.tables) {
                        jquery.each(data.tables, function(table) {
                            if (data.tables[table].hasOwnProperty("url")) {
                                tables.push(data.tables[table]);
                            }
                        });
                    }

                    var basemapTitle = data.baseMap.title;
                    var basemapLayers = [];
                    jquery.each(data.baseMap.baseMapLayers, function(layer) {
                        if (data.baseMap.baseMapLayers[layer].hasOwnProperty("url")) {
                            basemapLayers.push(data.baseMap.baseMapLayers[layer]);
                        }
                    });

                    var template = jquery("#webmapServicesTemplate").html();
                    var templateData = {
                        webmapTitle: webmapTitle,
                        operationalLayers: operationalLayers,
                        tables: tables,
                        basemapTitle: basemapTitle,
                        basemapLayers: basemapLayers
                    };
                    var html = mustache.to_html(template, templateData);

                    // Add the HTML container with the item JSON.
                    jquery("#dropArea").html(html);

                    // Event listener for update button.
                    jquery("#btnUpdateWebmapServices").click(function() {
                        var webmapServices = jquery("[data-original]");
                        jquery.each(webmapServices, function(service) {
                            var originalUrl = jquery(webmapServices[service])
                                .attr("data-original");
                            var newUrl = jquery(webmapServices[service]).val();

                            // Find and replace each URL.
                            webmapData = webmapData.replace("\"" + originalUrl + "\"", "\"" + newUrl + "\"");
                            jquery(webmapServices[service]).val(newUrl);
                        });

                        var webmapId = jquery(".content.active.btn-primary").attr("data-id");
                        var itemData = JSON.parse(webmapData);
                        portal.updateWebmapData(owner, folder, webmapId, itemData).done(function(response) {
                            var html;
                            if (response.success) {
                                // Set the stored original URL to the new value.
                                jquery.each(webmapServices, function(service) {
                                    jquery(webmapServices[service]).attr("data-original", jquery(webmapServices[service]).val());
                                });

                                html = mustache.to_html(jquery("#updateSuccessTemplate").html());
                                jquery("#btnResetWebmapServices").before(html);
                            } else if (response.error.code === 400 || response.error.code === 403) {
                                jquery("#btnResetWebmapServices").click(); // Reset the displayed URLs to their original values.
                                html = mustache.to_html(jquery("#updateErrorTemplate").html(), response);
                                jquery("#btnResetWebmapServices").before(html);
                            }
                        });
                    });

                    // Event listener for reset button.
                    jquery("#btnResetWebmapServices").click(function() {
                        var webmapServices = jquery("[data-original]");
                        jquery.each(webmapServices, function(service) {
                            var originalUrl = jquery(webmapServices[service]).attr("data-original");
                            jquery(webmapServices[service]).val(originalUrl);
                        });
                    });
                });
        });

    };

    var updateContentUrls = function() {
        var owner;
        var folder;
        var supportedContent = jquery(".content[data-type='Feature Service'], .content[data-type='Map Service'], .content[data-type='Image Service'], .content[data-type='KML'], .content[data-type='WMS'], .content[data-type='Geodata Service'], .content[data-type='Globe Service'], .content[data-type='Geometry Service'], .content[data-type='Geocoding Service'], .content[data-type='Network Analysis Service'], .content[data-type='Geoprocessing Service'], .content[data-type='Web Mapping Application'], .content[data-type='Mobile Application'], .content[data-type='Scene Service']");
        var portal = app.portals.sourcePortal;

        // Highlight supported content.
        supportedContent.addClass("data-toggle btn-info");
        supportedContent.removeAttr("disabled");
        supportedContent.attr("data-toggle", "button");

        // Add a listener for clicking on content buttons.
        jquery(".content").click(function() {

            // Display the selected item's URL.
            var id = jquery(this).attr("data-id");

            // Highlight Web Maps.
            supportedContent.addClass("btn-info");
            jquery(".content").removeClass("active");
            jquery(".content").removeClass("btn-primary");
            jquery(this).addClass("btn-primary");
            jquery(this).removeClass("btn-info");
            portal.itemDescriptions(id).done(function(description) {
                owner = description.owner;
                if (!description.ownerFolder) {
                    folder = ""; // Handle content in the user's root folder.
                } else {
                    folder = description.ownerFolder;
                }

                var html = mustache.to_html(jquery("#itemContentTemplate").html(), description);

                // Add the HTML container with the item JSON.
                jquery("#dropArea").html(html);

                // Event listener for update button.
                jquery("#btnUpdateContentUrl").click(function() {
                    var contentId = jquery(".content.active.btn-primary").attr("data-id");
                    var url = jquery("[data-original]").val();
                    portal.updateUrl(owner, folder, contentId, url).done(function(response) {
                        var html;
                        if (response.success) {
                            // Set the stored original URL to the new value.
                            jquery("[data-original]").attr("data-original", url);
                            html = mustache.to_html(jquery("#updateSuccessTemplate").html());
                            jquery("#btnResetContentUrl").before(html);
                        } else if (response.error.code === 400 || response.error.code === 403) {
                            jquery("#btnResetContentUrl").click(); // Reset the displayed URLs to their original values.
                            html = mustache.to_html(jquery("#updateErrorTemplate").html(), response);
                            jquery("#btnResetContentUrl").before(html);
                        }
                    });
                });

                // Event listener for reset button.
                jquery("#btnResetContentUrl").click(function() {
                    var originalUrl = jquery("[data-original]").attr("data-original");
                    jquery("[data-original]").val(originalUrl);
                });
            });
        });
    };

    var highlightExportSearchResultsToCSV = function() {

        var supportedContent = jquery(".content");

        // Highlight supported content.
        supportedContent.addClass("data-toggle btn-info");
        supportedContent.removeAttr("disabled");
        supportedContent.attr("data-toggle", "button");

        // Show the tooltips
        jquery(".hideToolTipOption").css("visibility", "visible");

        // Add a message to guide the user to select items
        var selectMsgHtml = jquery("#selectItemTemplate").html();
        jquery("#dropArea").html(selectMsgHtml);

        // Add a listener for clicking on content buttons.
        jquery(".content").click(function(event) {
            var owner, folder;

            // Display the selected item's URL.
            var id = jquery(this).attr("data-id");

            var datatype = jquery(this).attr("data-type");
            var portal = app.portals.sourcePortal;

            // Toggle the entry
            toggleContentEntry(jquery(this));

            // TODO: add shift-click control here to highlight intermediate entries when in multiple select mode
            if (event.shiftKey) {
                console.warn("Shift-click select is experimental and will exhibit unexpected behavior.");

                // TODO: Instead of making it the intermediate nodes, make it select all items
                // between the previously clicked item and then newly clicked one.
                var intermediateNodes = jquery(".content.btn-primary").first().nextUntil(this);

                intermediateNodes.removeClass("btn-info");
                intermediateNodes.addClass("btn-primary active");
            }

            // Update the selected item count.
            updateSelectedCount(jquery(this));

            if (isMultipleSelectionMode() && event.shiftKey) {
                id = jquery.map(jquery(".content.btn-primary"), function (element){
                  return element.id;
                });
            }

            var html = jquery("#exportResultsToCSVTemplate").html();

            // Add the HTML container with the item JSON.
            jquery("#dropArea").html(html);

            // Un-highlight the "export selected" button if none are selected
            if (jquery(".content.btn-primary").length === 0) {
                jquery("#btnExportItems").removeClass("btn-primary");
            } else {
                jquery("#btnExportItems").addClass("btn-primary");
            }

            // Event listener for export to CSV button.
            jquery("#btnExportItems").click(function() {

                // If no items are selected display an error
                if (jquery(".content.btn-primary").length === 0) {
                    alert("First select items to export.");
                    return;
                }

                var searchCategory = "item", exportRows = []; // Don't make the first export row item "ID" with that capitalization or you will enounter MS Excel error described here: https://support.microsoft.com/en-us/kb/215591
                if (jquery(".content[data-type='Group']").length > 0) {
                    searchCategory = "group";
                    exportRows.push(["Title", "Owner", "Id", "Type", "Tags", "Created", "Modified"]);
                } else if (jquery(".content[data-type='User']").length > 0) {
                    searchCategory = "user";
                    exportRows.push(["Username", "Full Name", "Tags", "Created", "Modified"]);
                } else {
                    searchCategory = "item";
                    exportRows.push(["Title", "Owner", "Name", "Id", "Type", "Type Keywords", "Tags", "Created", "Modified", "Number of Views", "Url"]);
                }

                jquery(".content.active[data-id]").each(function(index, el) {
                    var title = jquery(this).attr("data-title");
                    var id = jquery(this).attr("data-id");
                    var owner = jquery(this).attr("data-owner");
                    var type = jquery(this).attr("data-type");
                    var tags = jquery(this).attr("data-tags");
                    var created = jquery(this).attr("data-created");
                    var modified = jquery(this).attr("data-modified");
                    

                    // TODO: nath4868 "query is not defined" for jquery(this) call below, but in FF
                    // TODO: Convert over to using either a single metadata tag like this or to using a caching variable so that
                    // the data doesn't need to be stored in the html tags.
                    var itemMetaData = {};
                    if (jquery(this).attr("data-itemmetadata") && jquery(this).attr("data-itemmetadata") !== "") {
                        itemMetaData = JSON.parse(jquery(this).attr("data-itemmetadata").split("&quote;").join("\""));
                    }

                    if (searchCategory === "item") {
                        exportRows.push([title, owner, itemMetaData.name ? itemMetaData.name : "", id, type, itemMetaData.typeKeywords ? itemMetaData.typeKeywords : "", tags, created, modified, itemMetaData.numViews ? itemMetaData.numViews : "", itemMetaData.url ? itemMetaData.url : ""]);
                    } else if (searchCategory === "group") {
                        exportRows.push([title, owner, id, type, tags, created, modified]);
                    } else if (searchCategory === "user") {
                        exportRows.push([itemMetaData.username, itemMetaData.fullName, tags, created, modified]);
                    }
                });

                var today = new Date();
                var dd = today.getDate();
                var mm = today.getMonth()+1; //January is 0!

                if(dd<10) {
                    dd='0'+dd;
                } 

                if(mm<10) {
                    mm='0'+mm;
                } 

                today = mm+'/'+dd+'/'+today.getFullYear();

                exportToCsv("ArcGIS Online Assistant Export " + today + ".csv", exportRows);
            });
        });
    };

    var highlightReassignOwnershipContent = function() {

        // Highlight the supported content but exclude users as they are not valid
        var supportedContent = jquery(".content[data-type!='User']");

        // Determine if it is an item or a group.
        var isItem = true;
        var groupCount = jquery(".content[data-type='Group']");
        if (groupCount.length > 0) {
            isItem = false;
        }

        jquery(".hideToolTipOption").css("visibility", "visible");

        // Highlight supported content.
        supportedContent.addClass("data-toggle btn-info");
        supportedContent.removeAttr("disabled");
        supportedContent.attr("data-toggle", "button");

        var html = mustache.to_html(jquery("#reassignOwnershipTemplate").html(), {isItem: isItem});

        // Add the HTML container with the item JSON.
        jquery("#dropArea").html(html);

        // Add a listener for clicking on content buttons.
        jquery(".content").click(function(event) {
            var owner;
            var folder;

            // Display the selected item's URL.
            var id = jquery(this).attr("data-id");

            var datatype = jquery(this).attr("data-type");
            var portal = app.portals.sourcePortal;

            // Highlight Web Maps.
            if (!isMultipleSelectionMode()) {
                // single delete item operation not allowed
            } else  {

                // TODO: need to query item to get the owner folder before it can be completely "selected"
                // for the re-assign owner operation

                if (isItem) {
                    portal.itemDescriptions(id).done(function(description) {

                        if(arguments.length > 0) {
                            if (jquery.isArray(arguments[0]) && arguments[0].length && arguments[0][1] === "success") {
                                // Debugging only
                                console.debug("An array of results was returned to handle multiple items");
                            }
                        }

                        // Update the folder of the item
                        var folder = !description.ownerFolder ? "" : description.ownerFolder;

                        var itemNode = jquery("[data-id='" + description.id + "']");
                        itemNode.attr("data-ownerfolder", folder);

                        // in multiple selection mode, so only toggle the class that was clicked
                        if (itemNode.hasClass("btn-primary")) {
                            itemNode.removeClass("btn-primary");
                            itemNode.addClass("btn-info");
                        } else {
                            itemNode.addClass("btn-primary");
                            itemNode.removeClass("btn-info");
                        }

                        // TODO: add shift-click control here to highlight intermediate entries when in multiple select mode
                        if (event.shiftKey) {
                            console.warn("Shift-click select is experimental and will exhibit unexpected behavior.");

                            // TODO: Instead of making it the intermediate nodes, make it select all items
                            // between the previously clicked item and then newly clicked one.
                            var intermediateNodes = jquery(".content.btn-primary").first().nextUntil(itemNode);

                            intermediateNodes.removeClass("btn-info");
                            intermediateNodes.addClass("btn-primary active");
                        }

                        // Update the selected item count.
                        updateSelectedCount(itemNode);
                    });
                } else {
                    // else the click is a group and not an item
                    var entry = jquery(this);
                    if (entry.hasClass("btn-primary")) {
                        entry.removeClass("btn-primary");
                        entry.addClass("btn-info");
                    } else {
                        entry.addClass("btn-primary");
                        entry.removeClass("btn-info");
                    }
                }
            }

            if (isMultipleSelectionMode() && event.shiftKey) {
                id = jquery.map(jquery(".content.btn-primary"), function (element){
                  return element.id;
                });
            }

            // Add the appropriate new owner and new folder drop-downs
            var substringMatcherOwner = function(strs) {
                  return function findMatches(q, cb) {
                    var matches, substrRegex;

                    // an array that will be populated with substring matches
                    matches = [];

                    if (q.length === 0) {
                        cb(strs);
                    }

                    // regex used to determine if a string contains the substring `q`
                    substrRegex = new RegExp(q, 'i');

                    // iterate through the pool of strings and for any string that
                    // contains the substring `q`, add it to the `matches` array
                    jquery.each(strs, function(i, str) {
                      if (substrRegex.test(str)) {
                        matches.push(str);
                      }
                    });

                    cb(matches);
                  };
            };

            portal = app.portals.sourcePortal;
            var userMatches = [];
            portal.portalUsers().done(function(data) {

                jquery.each(data.users, function(index, el) {
                    userMatches.push(el.username);
                });

                jquery("#newOwnerValue").replaceWith('<input class="form-control" type="text" id="newOwnerValue" placeholder="New Owner" />');

                jquery('#newOwnerValue').typeahead({
                  hint: true,
                  highlight: true,
                  minLength: 0
                },
                {
                  name: 'newOwnerValue',
                  source: substringMatcherOwner(userMatches),
                  limit: Infinity
                });

            }).always(function() {

                    // Only items need a folder for assignment. Groups do not.
                    if (isItem) {
                        jquery('#newOwnerValue').bind('typeahead:change', function(ev, suggestion) {

                            portal.userContent(suggestion, "/").done(function(content) {
                                // Append the root folder accordion.

                                var userFolders = [];
                                jquery.each(content.folders, function(folder) {
                                    userFolders.push(content.folders[folder].title);
                                });

                                jquery("#newFolderValue").replaceWith('<input class="form-control" type="text" id="newFolderValue" placeholder="New Folder" />');

                                jquery('#newFolderValue').typeahead({
                                  hint: true,
                                  highlight: true,
                                  minLength: 0
                                },
                                {
                                  name: 'newFolderValue',
                                  source: substringMatcherOwner(userFolders),
                                  limit: Infinity
                                });

                            });
                        });
                    }
            });

            // un-highlight the "export selected" button if none are selected
            if (jquery(".content.btn-primary").length === 0) {
                jquery("#btnExportItems").removeClass("btn-primary");
            } else {
                jquery("#btnExportItems").addClass("btn-primary");
            }
        });

        // Event listener for reassign button.
        jquery("#btnReassignItems").click(function() {

                // if no items are selected, then do nothing
                if (jquery(".content.btn-primary").length === 0) {
                    alert("First select items to re-assign.");
                    return;
                }

                var portal = app.portals.sourcePortal;

                var newOwnerValue = jquery('#newOwnerValue').val();

                // if the re-assign is for an item, then retrieve the folder value
                var newFolderValue;
                if (isItem) {
                    newFolderValue = jquery('#newFolderValue').val();
                }

                var changeOwnershipRequests = [];
                jquery(".content.active[data-id]").each(function(index, el) {
                    var owner = jquery(this).attr("data-owner");
                    var id = jquery(this).attr("data-id");
                    var folder = jquery(this).attr("data-ownerfolder");
                    
                    if (isItem) {
                        console.debug("reassignItem:", owner, id, folder, newOwnerValue, newFolderValue);
                        changeOwnershipRequests.push(portal.reassignItem(owner, id, folder, newOwnerValue, newFolderValue));
                    } else {
                        // If it is a group. Is there a reassign operation for users?
                        changeOwnershipRequests.push(portal.reassignGroup(id, newOwnerValue));
                    }
                });

                jquery.when.apply(jquery, changeOwnershipRequests).then(function(results) {
                        if(arguments.length > 0) {
                            if (jquery.isArray(arguments[0]) && arguments[0].length && arguments[0][1] === "success") {
                                // Debugging only
                                console.debug("An array of results was returned to handle multiple items");
                            }
                        }
                        return arguments;
                }).done(function(composedResults) {
                        if (composedResults[0] && composedResults[0][0] && composedResults[0][0].error) {
                            alert("Error reassigning item: " + composedResults[0][0].error.message);

                            html = mustache.to_html(jquery("#updateErrorTemplate").html(), composedResults[0][0]);
                            jquery("#btnReassignItems").before(html);
                        } else {

                            var changeOwnershipMessages = composedResults[0];
                            if (changeOwnershipMessages.success) {
                                html = mustache.to_html(jquery("#updateSuccessTemplate").html());
                                jquery("#btnReassignItems").before(html);
                            }  else if (changeOwnershipMessages[0].success) {
                                html = mustache.to_html(jquery("#updateSuccessTemplate").html());
                                jquery("#btnReassignItems").before(html);
                            }

                            // TODO: Iterate over the returned change ownership response messsages
                            // jquery.each(changeOwnershipMessages, function( key, value) {
                            //     console.debug("changeOwnershipMessages, key, value:", key, value);
                            //     // if (value.success) {
                            //     //     jquery(".content.active[data-id='" + value.itemId +"']").remove();
                            //     // } else {
                            //     //     jquery(".content.active[data-id]").removeClass("btn-primary", "active").addClass("btn-danger");
                            //     // }
                            // });
                        }
                });
        });
    };

    /* Method from online source */
    var exportToCsv = function(filename, rows) {
        var processRow = function (row) {
            var finalVal = '';
            for (var j = 0; j < row.length; j++) {
                var innerValue = row[j] === null ? '' : row[j].toString();
                if (row[j] instanceof Date) {
                    innerValue = row[j].toLocaleString();
                }
                var result = innerValue.replace(/"/g, '""');
                if (result.search(/("|,|\n)/g) >= 0)
                    result = '"' + result + '"';
                if (j > 0)
                    finalVal += ',';
                finalVal += result;
            }
            return finalVal + '\n';
        };

        var csvFile = '';
        for (var i = 0; i < rows.length; i++) {
            csvFile += processRow(rows[i]);
        }

        var blob = new Blob([csvFile], { type: 'text/csv;charset=utf-8;' });
        if (navigator.msSaveBlob) { // IE 10+
            navigator.msSaveBlob(blob, filename);
        } else {
            var link = document.createElement("a");
            if (link.download !== undefined) { // feature detection
                // Browsers that support HTML5 download attribute
                var url = URL.createObjectURL(blob);
                link.setAttribute("href", url);
                link.setAttribute("download", filename);
                link.style.visibility = 'hidden';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            }
        }
    };

    var highlightBulkCopyableContent = function() {

        var setMaxWidth = function(el) {
            // Set the max-width of folder items so they don't fill the body when dragging.
            var maxWidth = jquery("#itemsArea .in").width() ? jquery("#itemsArea .in").width() : 400;
            jquery(el).css("max-width", maxWidth); // Set the max-width so it doesn't fill the body when dragging.
        };

        // Don't highlight groups or users for copy (these aren't handled yet)
        var supportedContent = jquery(".content[data-type!='Group']").filter(".content[data-type!='User']");

        // Show the tooltips
        jquery(".hideToolTipOption").css("visibility", "visible");

        var makeDraggable = function(el) {
                el.draggable({
                    cancel: false,
                    //helper: "clone",
                    helper: function() {
                        //var selected = $('#dragSource input:checked').parents('li');
                        var selected = jquery(".content.active[data-id]");
                        if (selected.length === 0) {
                          selected = jquery(this);
                        }
                        var container = jquery('<div/>').attr('id', 'draggingContainer');
                        container.append(selected.clone());
                        return container;
                    },
                    appendTo: "body",
                    revert: true,
                    opacity: 0.7
                });
                el.removeAttr("disabled");
        };

        supportedContent.each(function() {
            var type = jquery(this).attr("data-type");
            if (isSupported(type)) { // Highlight supported content.
                jquery(this).addClass("data-toggle btn-info");
                jquery(this).removeAttr("disabled");
                setMaxWidth(this);
                jquery(this).attr("data-toggle", "button");
                makeDraggable(jquery(this)); //Make the content draggable.
            }
        });

        // Add a listener for clicking on content buttons.
        jquery(".content").click(function(event) {
            var owner;
            var folder;

            // Display the selected item's URL.
            var id = jquery(this).attr("data-id");

            var datatype = jquery(this).attr("data-type");
            var portal = app.portals.sourcePortal;

            // Highlight Web Maps.
            if (!isMultipleSelectionMode()) {
                // single delete item operation not allowed
            } else  {
                // In multiple selection mode, so only toggle the class that was clicked

                // TODO: bug fix
                jquery(this).removeClass("btn-default");

                if (jquery(this).hasClass("btn-primary")) {
                    jquery(this).removeClass("btn-primary");
                    jquery(this).addClass("btn-info");
                } else {
                    jquery(this).addClass("btn-primary");
                    jquery(this).removeClass("btn-info");
                }

                // TODO: add shift-click control here to highlight intermediate entries when in multiple select mode
                if (event.shiftKey) {
                    console.warn("Shift-click select is experimental and will exhibit unexpected behavior.");

                    // TODO: Instead of making it the intermediate nodes, make it select all items
                    // between the previously clicked item and then newly clicked one.
                    var intermediateNodes = jquery(".content.btn-primary").first().nextUntil(this);
                    intermediateNodes.removeClass("btn-info");
                    intermediateNodes.addClass("btn-primary active");
                }

                // Update the selected item count.
                updateSelectedCount(jquery(this));
            }

            if (isMultipleSelectionMode() && event.shiftKey) {
                id = jquery.map(jquery(".content.btn-primary"), function (element){
                  return element.id;
                });
            }
        });
    };

    var viewStats = function() {

        var portal = app.portals.sourcePortal;

        var statsCalendar = function(activities) {
            require(["d3", "cal-heatmap"], function(d3, CalHeatMap) {
                // Create a date object for three months ago.
                var today = new Date();
                var startDate = new Date();
                startDate.setMonth(today.getMonth() - 2);
                if (today.getMonth() < 2) {
                    startDate.setYear(today.getFullYear() - 1);
                }

                var cal = new CalHeatMap();
                cal.init({
                    itemSelector: "#statsCalendar",
                    domain: "month",
                    subDomain: "day",
                    data: activities,
                    start: startDate,
                    cellSize: 10,
                    domainGutter: 10,
                    range: 3,
                    legend: [1, 2, 5, 10],
                    displayLegend: false,
                    tooltip: true,
                    itemNamespace: "cal",
                    previousSelector: "#calPrev",
                    nextSelector: "#calNext",
                    domainLabelFormat: "%b '%y",
                    subDomainTitleFormat: {
                        empty: "No activity on {date}",
                        filled: "Saved {count} {name} {connector} {date}"
                    },
                    domainDynamicDimension: false
                });
            });
        };

        portal.userProfile(portal.username)
            .done(function(user) {

                var template = jquery("#statsTemplate").html();
                var thumbnailUrl;

                // Check that the user has a thumbnail image.
                if (user.thumbnail) {
                    thumbnailUrl = portal.portalUrl +
                        "sharing/rest/community/users/" + user.username +
                        "/info/" + user.thumbnail + "?token=" +
                        portal.token;
                } else {
                    thumbnailUrl = "assets/images/no-user-thumb.jpg";
                }

                var templateData = {
                    username: user.username,
                    thumbnail: thumbnailUrl
                };

                var html = mustache.to_html(template, templateData);
                jquery("body").append(html);
                statsCalendar(app.stats.activities);

                jquery("#statsModal").modal("show");

                // Get the user's 3 most viewed items.
                var searchQuery = "owner:" + portal.username;
                portal.search(searchQuery, 3, "numViews", "desc")
                    .done(function(results) {
                        jquery.each(results.results, function(result) {
                            results.results[result].numViews =
                                results.results[result]
                                .numViews.toString()
                                .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
                            results.results[result].itemUrl =
                                portal.portalUrl +
                                "home/item.html?id=" +
                                results.results[result].id;
                        });

                        var tableTemplate = jquery("#mostViewedContentTemplate").html();
                        jquery("#mostViewedContent").html(mustache.to_html(tableTemplate, {
                            searchResults: results.results
                        }));
                    });

                jquery("#statsModal").on("shown.bs.modal", function() {
                    // Apply CSS to style the calendar arrows.
                    var calHeight = jquery(".calContainer").height();

                    // Center the calendar.
                    jquery(".cal-heatmap-container").css("margin", "auto");

                    // Adjust the arrows.
                    jquery(".calArrow").css("margin-top", (calHeight - 20) + "px");
                });

                jquery("#statsModal").on("hidden.bs.modal", function() {
                    // Destroy the stats modal so it can be properly rendered next time.
                    jquery("#statsModal").remove();
                });

            });
    };

    // Check if the service name is available.
    var checkServiceName = function(destinationPortal) {
        var deferred = new jquery.Deferred();
        var nameInput = jquery("#serviceName");
        jquery("#serviceName").off("blur"); // Prevent duplicate listeners.
        nameInput.blur(function() {
            var name = nameInput.val();
            destinationPortal.self()
                .then(function(self) {
                    destinationPortal.checkServiceName(self.user.orgId, name, "Feature Service")
                        .then(function(available) {
                            if (available.available !== true) {
                                var nameError = mustache.to_html(jquery("#serviceNameErrorTemplate").html(), {
                                    name: name
                                });

                                // Prevent appending duplicate error messages.
                                jquery(".alert-danger.alert-dismissable").remove();
                                nameInput.parent().parent().after(nameError);
                                nameInput.parent().addClass("has-error");
                                nameInput.next().removeClass("glyphicon-ok");
                            } else {
                                name = nameInput.val();
                                jquery(".alert-danger.alert-dismissable").remove();
                                nameInput.parent().removeClass("has-error");
                                nameInput.next().addClass("glyphicon-ok");
                                jquery("#btnCopyService").removeClass("disabled");
                                deferred.resolve(name);
                            }
                        });
                });
        });

        return deferred.promise();
    };

    var showCopyError = function(id, message) {
        var html = mustache.to_html(jquery("#contentCopyErrorTemplate").html(), {
            id: id,
            message: message
        });
        jquery("#" + id + "_clone").before(html);
    };

    /**
     * simpleCopy() Copies a given item ID.
     * @id {String} id of the source item
     * @folder {String} id of the destination folder
     */
    var simpleCopy = function(id, folder) {
        var portalUrl = jquery("#" + id).attr("data-portal");
        var portal;
        /**
         * Prevent trying to pass a portal token when
         * copying content from ArcGIS Online.
         */
        if (portalUrl === "https://www.arcgis.com/" &&
            portalUrl !== app.portals.sourcePortal.portalUrl) {
            portal = app.portals.arcgisOnline;
        } else {
            portal = app.portals.sourcePortal;
        }

        var destinationPortal = app.portals.destinationPortal;
        var item = jquery.grep(portal.items, function(item) {
            return (item.id === id);
        });

        var description = item[0].description;
        var thumbnailUrl = portal.portalUrl + "sharing/rest/content/items/" + id + "/info/" +
            description.thumbnail + "?token=" + portal.token;
        portal.itemData(id).always(function(data) {
            /**
             * Post it to the destination using always
             * to ensure that it copies Web Mapping Applications
             * which don't have a data component and therefore
             * generate a failed response.
             */
            destinationPortal.addItem(destinationPortal.username, folder, description, data, thumbnailUrl)
                .done(function(response) {
                    var html;
                    if (response.success === true) {
                        // Update the id parameter to reflect the new item's id.
                        if (description.url.indexOf("id=") > -1) {
                            var newUrl = description.url.substring(description.url.indexOf("/apps/"));
                            newUrl = newUrl.replace("id=" + description.id, "id=" + response.id);
                            var folder = response.folder || "";
                            destinationPortal.updateUrl(destinationPortal.username, folder, response.id, newUrl)
                                .done(function() {
                                    jquery("#" + id + "_clone").addClass("btn-success");
                                });
                        } else {
                            jquery("#" + id + "_clone").addClass("btn-success");
                        }
                    } else if (response.error) {
                        jquery("#" + id + "_clone").addClass("btn-danger");
                        html = mustache.to_html(jquery("#contentCopyErrorTemplate").html(), {
                            id: id,
                            message: response.error.message
                        });
                        jquery("#" + id + "_clone").before(html);
                    }
                })
                .fail(function() {
                    showCopyError(id, "Something went wrong.");
                });
        });
    };

    var deepCopyFeatureService = function(id, folder) {
        var portalUrl = jquery("#" + id).attr("data-portal");
        var portal;
        /**
         * Prevent trying to pass a portal token when
         * copying content from ArcGIS Online.
         */
        if (portalUrl === "https://www.arcgis.com/" &&
            portalUrl !== app.portals.sourcePortal.portalUrl) {
            portal = app.portals.arcgisOnline;
        } else {
            portal = app.portals.sourcePortal;
        }

        var destinationPortal = app.portals.destinationPortal;
        var name = jquery("#serviceName").val();
        var item = jquery.grep(portal.items, function(item) {
            return (item.id === id);
        });

        var description = item[0].description;
        var serviceDescription = item[0].serviceDescription;
        var layers = serviceDescription.layers;

        // Preserve the icon on the cloned button.
        var span = jquery("#" + id + "_clone > span");
        jquery("#" + id + "_clone").text(name);
        jquery("#" + id + "_clone").prepend(span);
        serviceDescription.name = name;
        var serviceDefinition = serviceDescription;
        delete serviceDefinition.layers;
        destinationPortal.createService(destinationPortal.username, folder, JSON.stringify(serviceDefinition)).then(function(service) {
            var clone = jquery("#" + id + "_clone");
            clone.addClass("btn-info");
            clone.append("<img src='css/grid.svg' class='harvester'/>");
            clone.attr("data-id", service.itemId);
            clone.attr("data-portal", destinationPortal.portalUrl);

            console.debug("service.serviceurl:", service.serviceurl);

            // Upgrade the service url to https to prevent mixed content errors.
            service.serviceurl = portalUtil.upgradeUrl(service.serviceurl);

            // Update the new item's tags to make it easier to trace its origins.
            var newTags = description.tags;
            newTags.push("source-" + description.id);
            destinationPortal.updateDescription(destinationPortal.username, service.itemId, folder, JSON.stringify({
                tags: newTags
            }));
            portal.serviceLayers(description.url)
                .then(function(definition) {
                    /*
                     * Force in the spatial reference.
                     * Don't know why this is necessary, but if you
                     * don't then any geometries not in 102100 end up
                     * on Null Island.
                     */
                    jquery.each(definition.layers, function(i, layer) {
                        layer.adminLayerInfo = {
                            geometryField: {
                                name: "Shape",
                                srid: 102100
                            }
                        };
                    });


                    destinationPortal.addToServiceDefinition(service.serviceurl, JSON.stringify(definition))
                        .then(function(response) {
                            if (!("error" in response)) {
                                jquery.each(layers, function(i, v) {
                                    var layerId = v.id;
                                    portal.layerRecordCount(description.url, layerId)
                                        .then(function(records) {
                                            var offset = 0;

                                            // Set the count manually in weird cases where maxRecordCount is negative.
                                            var count = definition.layers[layerId].maxRecordCount < 1 ? 1000 : definition.layers[layerId].maxRecordCount;
                                            var added = 0;
                                            var x = 1;
                                            while (offset <= records.count) {
                                                x++;
                                                portal.harvestRecords(description.url, layerId, offset)
                                                    .then(function(serviceData) {
                                                        destinationPortal.addFeatures(service.serviceurl, layerId, JSON.stringify(serviceData.features))
                                                            .then(function() {
                                                                added += count;
                                                                if (added >= records.count) {
                                                                    jquery("#" + id + "_clone > img").remove();
                                                                    jquery("#" + id + "_clone").removeClass("btn-info");
                                                                    jquery("#" + id + "_clone").addClass("btn-success");
                                                                }
                                                            });
                                                    });

                                                offset += count;
                                            }
                                        });
                                });
                            } else {
                                jquery("#" + id + "_clone > img").remove();
                                jquery("#" + id + "_clone").removeClass("btn-info");
                                jquery("#" + id + "_clone").addClass("btn-danger");
                                var message = response.error.message;
                                showCopyError(id, message);
                            }
                        })
                        .fail(function() {
                            jquery("#" + id + "_clone > img").remove();
                            jquery("#" + id + "_clone").removeClass("btn-info");
                            jquery("#" + id + "_clone").addClass("btn-danger");
                            var message = "Something went wrong.";
                            showCopyError(id, message);
                        });
                });
        });
    };

    var completeMoveItems = function(items, destination) {

        // iterate each move item
        jquery.each(items, function(index, value) {
            var currentItem = value;
            var itemId = jquery(currentItem).attr("data-id");

            // Clone the original item.
            var clone = jquery(currentItem).clone();

            // Differentiate this object from the original.
            clone.attr("id", itemId + "_clone");
            clone.addClass("clone");

            clone.find(".hideToolTipOption").css("visibility", "hidden");

            // Remove the max-width property so it fills the folder.
            clone.css("max-width", "");

            // Move it to the destination folder.
            clone.insertAfter(destination.children(".dropArea"));

            // Remove the contextual highlighting.
            clone.removeClass("active btn-primary btn-info");

            // Get the folder the item was dragged into.
            var destinationFolder = clone.parent().attr("data-folder");

            copyItem(itemId, destinationFolder);
        });
    };

    /**
     * copyItem() Copies a given item ID.
     * @id {String} ID of the source item
     * @folder {String} id of the destination folder
     */
    var copyItem = function(id, folder) {

        var destinationPortal = app.portals.destinationPortal;
        var portal;

        var type = jquery("#" + id).attr("data-type");
        var portalUrl = jquery("#" + id).attr("data-portal");
        /**
         * Prevent trying to pass a portal token when
         * copying content from ArcGIS Online.
         */
        if (portalUrl === "https://www.arcgis.com/" &&
            portalUrl !== app.portals.sourcePortal.portalUrl) {
            portal = app.portals.arcgisOnline;
        } else {
            portal = app.portals.sourcePortal;
        }

        // Ensure the content type is supported before trying to copy it.
        if (isSupported(type)) {
            // Get the full item description and data from the source.
            portal.itemDescriptions(id).done(function(description) {
                portal.cacheItem(description);
                switch (type) {
                case "Feature Service":

                    // Upgrade the service url to https to prevent mixed content errors.
                    description.url = portalUtil.upgradeUrl(description.url);

                    // Also update the cached url.
                    portal.items[portal.items.length - 1].description.url = description.url;

                    portal.serviceDescription(description.url).done(function(serviceDescription) {
                        var item = jquery.grep(portal.items, function(item) {
                            return (item.id === id);
                        });

                        var name = description.name;
                        if (name === null) {
                            name = description.title;
                        }

                        jquery("#serviceName").val(name);
                        item[0].serviceDescription = serviceDescription;
                        jquery("#btnCancelCopy").attr("data-id", description.id);
                        jquery("#btnCopyService").attr("data-id", description.id);
                        jquery("#deepCopyModal").modal("show");
                        jquery("#btnCopyService").removeClass("disabled");

                        // Add a listener for the service name form.
                        checkServiceName(destinationPortal);
                    });

                    break;
                default:
                    simpleCopy(id, folder);
                }
            });
        } else {
            // Not supported.
            jquery("#" + id).addClass("btn-warning");
            var html = mustache.to_html(jquery("#contentTypeErrorTemplate").html(), {
                id: id,
                type: type
            });
            jquery("#" + id).before(html);
            jquery("#" + id + "_alert").fadeOut(6000);
        }
    };

    // Make the drop area accept content items.
    var makeDroppable = function(id) {

        var destinationPortal = app.portals.destinationPortal;
        var portal;

        /**
         * Move the content DOM element from the source
         * to the destination container on the page.
         */
        var moveItem = function(item, destination) {
            "use strict";

            var itemId = jquery(item).attr("data-id");

            // Clone the original item.
            var clone = jquery(item).clone();

            // Differentiate this object from the original.
            clone.attr("id", itemId + "_clone");
            clone.addClass("clone");
            clone.find(".hideToolTipOption").css("visibility", "hidden");

            // Remove the max-width property so it fills the folder.
            clone.css("max-width", "");

            // Move it to the destination folder.
            clone.insertAfter(destination.children(".dropArea"));

            // Remove the contextual highlighting.
            clone.removeClass("active btn-primary btn-info");

            // Get the folder the item was dragged into.
            var destinationFolder = clone.parent().attr("data-folder");

            copyItem(itemId, destinationFolder);
        };
        /**
         * Move the content DOM elements from the source
         * to the destination container on the page.
         */
        var moveItems = function(items, destination) {
            "use strict";

            if (app.copyWarning) {
                // set value on the button to carry-thru
                jquery("#btnBulkCopyServices").data({
                    "data-items": items,
                    "data-destination": destination
                });

                if (app.copyWarningText) {
                    jquery(".copywarningtxt").html(app.copyWarningText);
                }

                jquery("#bulkCopyWarningModal").modal("show");
                jquery("#btnBulkCopyServices").removeClass("disabled");
            } else {
                completeMoveItems(items, destination);
            }
        };

        jquery("#dropFolder_" + id).droppable({
            accept: ".content",
            activeClass: "ui-state-hover",
            hoverClass: "ui-state-active",
            tolerance: 'touch', // tolerance added for drops of multiple items. Another more restrictive value to use is 'pointer'
            drop: function(event, ui) {

                var helperContainedButtons = ui.helper.find(".content");
                var multipleCount = helperContainedButtons.length;
                if (multipleCount === 0) {
                    moveItem(ui.draggable, jquery(this).parent().parent());
                } else {
                    moveItems(helperContainedButtons, jquery(this).parent().parent());
                }
            }
        });
    };

    var cleanUp = function() {
        jquery("#dropArea").empty(); //Clear any old items.
        jquery(".content").unbind("click"); // Remove old event handlers.
        jquery(".content").removeClass("active btn-primary btn-info ui-draggable");
        //jquery(".content").attr("disabled", "disabled"); // must not disable if hovers will work
    };

    var clearResults = function() {
        // Clean up any existing content in the left hand column.
        jquery("#itemsArea").empty();
    };

    var highlightCopyableContent = function() {

        var setMaxWidth = function(el) {
            // Set the max-width of folder items so they don't fill the body when dragging.
            var maxWidth = jquery("#itemsArea .in").width() ? jquery("#itemsArea .in").width() : 400;
            jquery(el).css("max-width", maxWidth); // Set the max-width so it doesn't fill the body when dragging.
        };

        jquery("#itemsArea .content").each(function() {

            var makeDraggable = function(el) {
                el.draggable({
                    cancel: false,
                    helper: "clone",
                    appendTo: "body",
                    revert: true,
                    opacity: 0.7
                });
                el.removeAttr("disabled");
            };

            var type = jquery(this).attr("data-type");
            if (isSupported(type)) {
                jquery(this).addClass("btn-info"); // Highlight supported content.
                setMaxWidth(this);
                makeDraggable(jquery(this)); //Make the content draggable.
            }
        });
    };

    var highlightUpdateTagsContent = function() {

        var supportedContent = jquery(".content");

        // Show the tooltips
        jquery(".hideToolTipOption").css("visibility", "visible");

        // Highlight supported content.
        supportedContent.addClass("data-toggle btn-info");
        supportedContent.removeAttr("disabled");
        supportedContent.attr("data-toggle", "button");

        // Add a message to guide the user to select items
        var selectMsgHtml = jquery("#selectItemTemplate").html();
        jquery("#dropArea").html(selectMsgHtml);

        // Add a listener for clicking on content buttons.
        jquery(".content").click(function(event) {
            var owner, folder;

            // Display the selected item's URL.
            var id = jquery(this).attr("data-id");

            var datatype = jquery(this).attr("data-type");
            var tags = jquery(this).attr("data-tags");
            var portal = app.portals.sourcePortal;

            // Highlight Web Maps.
            if (!isMultipleSelectionMode()) {
                jquery(".content").removeClass("active btn-primary");
                supportedContent.addClass("btn-info");

                jquery(this).addClass("btn-primary");
                jquery(this).removeClass("btn-info");

            } else {

                // In multiple selection mode, so only toggle the class that was clicked
                toggleContentEntry(jquery(this));

                // TODO: add shift-click control here to highlight intermediate entries when in multiple select mode
                if (event.shiftKey) {
                    console.debug("Shift-click select is experimental and will exhibit unexpected behavior.");

                    // TODO: Instead of making it the intermediate nodes, make it select all items
                    // between the previously clicked item and then newly clicked one.
                    var intermediateNodes = jquery(".content.btn-primary").first().nextUntil(this);
                    intermediateNodes.removeClass("btn-info");
                    intermediateNodes.addClass("btn-primary active");
                }

                // Update the selected item count.
                updateSelectedCount(jquery(this));
            }

            if (isMultipleSelectionMode() && event.shiftKey) {
                id = jquery.map(jquery(".content.btn-primary"), function (element){
                  return element.id;
                });
            }

            var displayAddRemoveTags  = function(description) {

                // transform to a normal response array
                if(arguments.length > 0) {
                    if (jquery.isArray(arguments[0]) && arguments[0].length && arguments[0][1] === "success") {
                        // debugging only
                        console.debug("An array of results was returned to handle multiple items");
                    }
                }

                if (jquery.isArray(description)) {
                    // debugging only
                    console.debug("Description response is an array.");
                }

                // Determine the id of the element
                var itemId;
                if (datatype === "User") {
                     // identify users by username (unique) since users don't have an id field
                    itemId = description.username;
                } else {
                    // both items and groups can use the "id" field
                    itemId = description.id;
                }

                // TODO: Here the itemId isn't valid on a multiple selection as it is an array.
                // need to loop through and update the DOM for each id.

                // Update the content item's tags data
                jquery("[data-id='" + itemId + "']").attr("data-itemstags", description.tags);

                // Update the hover tooltip
                console.debug("updated tags:", description.tags);
                var elToolTip = jquery("[data-id='" + itemId + "']").find(".contentToolTip");
                console.debug("elToolTip:", elToolTip);
                var newToolTipText = mustache.to_html("<b>Tags:</b><ul>{{tooltipText.tags}}</ul>{{#tooltipText.id}}<b>Id:</b><ul>{{tooltipText.id}}</ul>{{/tooltipText.id}}{{#tooltipText.access}}<b>Access:</b><ul>{{tooltipText.access}}</ul>{{/tooltipText.access}}", {tooltipText: {tags: description.tags.join(", "), access: description.access, id: description.id}});
                console.debug("THIS IS THE RIGHT VERSION::", newToolTipText);
                elToolTip.tooltip('hide').attr('data-original-title', newToolTipText).tooltip('fixTitle');

                
                // Update the folder of the item
                owner = description.owner;
                var folder;
                if (!description.ownerFolder) {
                    folder = ""; // Handle content in the user's root folder.
                } else {
                    folder = description.ownerFolder;
                }
                jquery("[data-id='" + itemId + "']").attr("data-ownerfolder", folder);

                var allTags = [];

                if (isMultipleSelectionMode()) {
                    var contentItemsWithTags = jquery(".active[data-itemstags]");

                    // Query all active items and obtain the tags
                    jquery(".active[data-itemstags]").each(function(index, el) {
                        allTags = allTags.concat(jquery(this).attr("data-itemstags").split(","));
                    });
                } else {
                    allTags = description.tags;
                }

                owner = description.owner;
                if (!description.ownerFolder) {
                    folder = ""; // Handle content in the user's root folder.
                } else {
                    folder = description.ownerFolder;
                }

                var html;
                if (isMultipleSelectionMode()) {
                    html = mustache.to_html(jquery("#addRemoveTagsTemplate").html(), description); // TODO: switch to addRemoveTagsTemplate
                } else {
                   console.error("This is a multiple selection tool only currently.");
                }

                // Add the HTML container with the item JSON.
                jquery("#dropArea").html(html);

                var existingTagsInputArray = [], indexArray = [];
                jquery.each(allTags, function(index, value) {
                    console.debug("index, value:", index, value);
                    console.debug("jquery.inArray(value, indexArray):", jquery.inArray(value, indexArray));
                    if (jquery.inArray(value, indexArray) === -1) {
                        existingTagsInputArray.push({id: value, text: value});
                        indexArray.push(value);
                    }
                });

                console.debug("existingTagsInputArray::", existingTagsInputArray);

               // Create the current tags input
               jquery("#addremovetagsinput").select2({
                  tags: true,
                  theme: "bootstrap",
                  data: existingTagsInputArray
                });

                var updateTags = function(itemInfo) {
                    var ownerFolder;
                    if (itemInfo.ownerFolder) {
                        ownerFolder = itemInfo.ownerFolder;
                    } else {
                        ownerFolder = "/";
                    }

                    var finalTagsToUse =  jquery("#currentTagsInput").val();

                    portal.updateDescription(itemInfo.owner, itemInfo.id, ownerFolder, JSON.stringify({
                        tags: finalTagsToUse
                    })).done(function(response) {
                        console.log("Response:", response);
                    });
                };

                // Event listener for update button.
                jquery("#btnUpdateRemoveTags").click(function() {

                    var isRemove = (jquery(".btn-primary[data-action='changetagaddremove']").attr("id") === "removeTagsButton") ? true : false;

                    var finalTagsToUse =  jquery("#addremovetagsinput").val();

                    var itemsToUpdate = [];
                    var tags;
                    jquery(".content.active[data-id]").each(function(index, el) {

                        tags = jquery(this).attr("data-itemstag");

                        var tagsArray;
                        var itemTags = jquery(this).attr("data-itemstags").split(",");
                        if (isRemove) {
                            var removeArray;
                            if (!jquery.isArray(finalTagsToUse)) {
                                removeArray = [finalTagsToUse];
                            } else {
                                removeArray = finalTagsToUse;
                            }
                            tagsArray = jquery.grep(itemTags, function(value) {
                              return jquery.inArray(value, removeArray) == -1;
                            });
                        } else {
                            tagsArray = finalTagsToUse.concat(itemTags);
                        
                        }

                        console.debug("tagsArray::::", tagsArray);


                        // TODO: handle case where tag added is already on that specific item
                        itemsToUpdate.push({
                            username: jquery(this).attr("data-owner"),
                            id: jquery(this).attr("data-id"),
                            folder: jquery(this).attr("data-ownerfolder"),
                            description: JSON.stringify({
                                tags: tagsArray
                            })
                        });
                    });

                    if (datatype === "User") {
                        //portal.userProfile(id).done(updateTags); // TODO: Add this branch to make add/removing tags work for users
                    } else if (datatype === "Group") {
                        //portal.groupInfo(id).done(updateTags); // TODO: Add this branch to make add/removing tags work for groups
                    } else {

                        portal.updateDescription(itemsToUpdate).done(function(response) {

                            console.debug("response:$$$:", response);

                            jquery(response).each(function(index, value) {

                                console.debug("Updating tags value variable:", value);

                                var result = value[0];
/*                                if (value.success) {
                                    result = value;
                                } else {
                                    result = value[0];
                                }*/

                                console.debug("result variable::::", result);

                                if (value.error) {
                                    console.error("There was an error updating the tag:", value.error);
                                    //jquery(".content.active[data-id='" + result.id +"']").removeClass("btn-primary", "active").addClass("btn-danger");
                                } else if (result.success) {
                                    var highlightItem = jquery(".content.active[data-id='" + result.id +"']");

                                    highlightItem.click();
                                    
                                    highlightItem.addClass("transitionClass");
                                    highlightItem.css("background-color", "#5cc864"); // alternate color to try: "#b4f09b"

                                    setTimeout(function(){
                                            highlightItem.css("background-color", "");
                                            //highlightItem.removeClass("btn-primary active").addClass("btn-info");
                                            setTimeout(function(){
                                                highlightItem.click();
                                                highlightItem.removeClass("transitionClass");
                                            }, 1000);
                                            
                                    }, 1000);

                                // var filterPanel = existingMatchingFilters.find(".filterPanelHeading");
                                // filterPanel.css("background-color", "#5cc864"); // alternate color to try: "#b4f09b"
                                // setTimeout(function(){ filterPanel.css("background-color", ""); }, 1000);

                                } else if (result.error) {
                                    console.debug("result::::", result);
                                    console.error("There was an error updating the tag:", result.error);
                                    var html = mustache.to_html(jquery("#errorTemplate").html(), {
                                        id: id,
                                        title: "Error updating tags!",
                                        message: result.error.message
                                    });
                                    jquery("#" + id).before(html);
                                }

                                // TODO: highlight the updated items
                                // var filterPanel = existingMatchingFilters.find(".filterPanelHeading");
                                // filterPanel.css("background-color", "#5cc864"); // alternate color to try: "#b4f09b"
                                // setTimeout(function(){ filterPanel.css("background-color", ""); }, 1000);
                            });
                        });
                    }
                });

                // Event listener for changing mode between add/remove
                jquery("[data-action='changetagaddremove']").click(function(event) {
                    jquery("[data-action='changetagaddremove']").removeClass("btn-primary active");
                    jquery(event.target).addClass("btn-primary active");
                });
            };

            // TODO: For update/view tags to work for users need to conditionall call portal.userProfile(id) here
            // instead if the data-type === "User". Look for a better way to consolidate the handling function so it
            // can be referenced by both calls. Also need to handle case where data-type === "Group" (call something like portal.groupInfo())
            if (datatype === "User") {
                portal.userProfile(id).done(displayAddRemoveTags); // switched from displayTagEditing
            } else if (datatype === "Group") {
                portal.groupInfo(id).done(displayAddRemoveTags); // switched from displayTagEditing
            } else {
                portal.itemDescriptions(id).done(displayAddRemoveTags); // switched from displayTagEditing
            }
        });
    };

    var highlightUpdateProtectionContent = function() {

        var supportedContent = jquery(".content[data-type!='Group']").filter(".content[data-type!='User']");

        // Show the tooltips
        jquery(".hideToolTipOption").css("visibility", "visible");

        // Highlight supported content.
        supportedContent.addClass("data-toggle btn-info");
        supportedContent.removeAttr("disabled");
        supportedContent.attr("data-toggle", "button");

        // Add a message to guide the user to select items
        var selectMsgHtml = jquery("#selectItemTemplate").html();
        jquery("#dropArea").html(selectMsgHtml);

        // Add a listener for clicking on content buttons.
        jquery(".content").click(function(event) {
            var owner, folder;

            // Display the selected item's URL.
            var id = jquery(this).attr("data-id");

            var datatype = jquery(this).attr("data-type");
            var tags = jquery(this).attr("data-tags");
            var portal = app.portals.sourcePortal;

            // Highlight Web Maps.
            if (!isMultipleSelectionMode()) {
                jquery(".content").removeClass("active btn-primary");
                supportedContent.addClass("btn-info");

                jquery(this).addClass("btn-primary");
                jquery(this).removeClass("btn-info");

            } else {

                // In multiple selection mode, so only toggle the class that was clicked
                toggleContentEntry(jquery(this));

                // TODO: add shift-click control here to highlight intermediate entries when in multiple select mode
                if (event.shiftKey) {
                    console.debug("Shift-click select is experimental and will exhibit unexpected behavior.");

                    // TODO: Instead of making it the intermediate nodes, make it select all items
                    // between the previously clicked item and then newly clicked one.
                    var intermediateNodes = jquery(".content.btn-primary").first().nextUntil(this);
                    intermediateNodes.removeClass("btn-info");
                    intermediateNodes.addClass("btn-primary active");
                }

                // Update the selected item count.
                updateSelectedCount(jquery(this));
            }

            if (isMultipleSelectionMode() && event.shiftKey) {
                id = jquery.map(jquery(".content.btn-primary"), function (element){
                  return element.id;
                });
            }

            var updateProtectionStatuses  = function(description) {

                // transform to a normal response array
                if(arguments.length > 0) {
                    if (jquery.isArray(arguments[0]) && arguments[0].length && arguments[0][1] === "success") {
                        // debugging only
                        console.debug("An array of results was returned to handle multiple items");
                    }
                }

                if (jquery.isArray(description)) {
                    // debugging only
                    console.debug("Description response is an array.");
                }

                // Determine the id of the element
                var itemId = description.id;

                // TODO: Here the itemId isn't valid on a multiple selection as it is an array.
                // need to loop through and update the DOM for each id.

                // Update the folder of the item
                owner = description.owner;
                var folder;
                if (!description.ownerFolder) {
                    folder = ""; // Handle content in the user's root folder.
                } else {
                    folder = description.ownerFolder;
                }
                jquery("[data-id='" + itemId + "']").attr("data-ownerfolder", folder);

                owner = description.owner;
                if (!description.ownerFolder) {
                    folder = ""; // Handle content in the user's root folder.
                } else {
                    folder = description.ownerFolder;
                }

                var html;
                if (isMultipleSelectionMode()) {
                    html = mustache.to_html(jquery("#updateItemProtectionTemplate").html(), description); // TODO: switch to addRemoveTagsTemplate
                } else {
                   console.error("This is a multiple selection tool only currently.");
                }

                // Add the HTML container with the item JSON.
                jquery("#dropArea").html(html);

                // Event listener for update button.
                jquery("#btnUpdateItemProtection").click(function() {

                    var isEnable = (jquery(".btn-primary[data-action='changeprotection']").attr("id") === "enableProtectionBtn") ? true : false;
                    var itemsToUpdate = [];
                    jquery(".content.active[data-id]").each(function(index, el) {
                        itemsToUpdate.push({
                            username: jquery(this).attr("data-owner"),
                            id: jquery(this).attr("data-id"),
                            folder: jquery(this).attr("data-ownerfolder")
                        });
                    });

                    console.debug("itemsToUpdate: ", itemsToUpdate);

                    if (isEnable) {
                        portal.protectItem(itemsToUpdate).done(function(response) {

                            jquery(response).each(function(index, value) {

                                var result = value[0];

                                if (value.error) {
                                    console.error("There was an error updating the tag:", value.error);
                                    //jquery(".content.active[data-id='" + result.id +"']").removeClass("btn-primary", "active").addClass("btn-danger");
                                } else if (result.success) {
                                    var highlightItem = jquery(".content.active[data-id='" + result.id +"']");
                                    
                                    highlightItem.addClass("transitionClass");
                                    highlightItem.css("background-color", "#5cc864"); // alternate color to try: "#b4f09b"

                                    setTimeout(function(){
                                            highlightItem.css("background-color", "");
                                            //highlightItem.removeClass("btn-primary active").addClass("btn-info");
                                            setTimeout(function(){ highlightItem.removeClass("transitionClass");}, 1000);
                                            
                                    }, 1000);

                                // var filterPanel = existingMatchingFilters.find(".filterPanelHeading");
                                // filterPanel.css("background-color", "#5cc864"); // alternate color to try: "#b4f09b"
                                // setTimeout(function(){ filterPanel.css("background-color", ""); }, 1000);

                                } else if (result.error) {
                                     console.error("There was an error updating the tag:", result.error);
                                }

                                // TODO: highlight the updated items
                                // var filterPanel = existingMatchingFilters.find(".filterPanelHeading");
                                // filterPanel.css("background-color", "#5cc864"); // alternate color to try: "#b4f09b"
                                // setTimeout(function(){ filterPanel.css("background-color", ""); }, 1000);
                            });
                        });
                    } else {
                        portal.unprotectItem(itemsToUpdate).done(function(response) {

                            jquery(response).each(function(index, value) {

                                var result = value[0];

                                if (value.error) {
                                    console.error("There was an error updating the tag:", value.error);
                                    //jquery(".content.active[data-id='" + result.id +"']").removeClass("btn-primary", "active").addClass("btn-danger");
                                } else if (result.success) {
                                    var highlightItem = jquery(".content.active[data-id='" + result.id +"']");
                                    
                                    highlightItem.addClass("transitionClass");
                                    highlightItem.css("background-color", "#5cc864"); // alternate color to try: "#b4f09b"

                                    setTimeout(function(){
                                            highlightItem.css("background-color", "");
                                            //highlightItem.removeClass("btn-primary active").addClass("btn-info");
                                            setTimeout(function(){ highlightItem.removeClass("transitionClass");}, 1000);
                                            
                                    }, 1000);

                                // var filterPanel = existingMatchingFilters.find(".filterPanelHeading");
                                // filterPanel.css("background-color", "#5cc864"); // alternate color to try: "#b4f09b"
                                // setTimeout(function(){ filterPanel.css("background-color", ""); }, 1000);

                                } else if (result.error) {
                                     console.error("There was an error updating the tag:", result.error);
                                }

                                // TODO: highlight the updated items
                                // var filterPanel = existingMatchingFilters.find(".filterPanelHeading");
                                // filterPanel.css("background-color", "#5cc864"); // alternate color to try: "#b4f09b"
                                // setTimeout(function(){ filterPanel.css("background-color", ""); }, 1000);
                            });
                        });
                    }
                });

                // Event listener for changing mode between add/remove
                jquery("[data-action='changeprotection']").click(function(event) {
                    jquery("[data-action='changeprotection']").removeClass("btn-primary active");
                    jquery(event.target).addClass("btn-primary active");
                });
            };

            // obtain the descriptions of the items and then perform the updating of protection statuses of items
            portal.itemDescriptions(id).done(updateProtectionStatuses);
        });
    };

    var highlightDeleteContent = function() {
        "use strict";

        // Don't highlight groups or users for delete (these aren't handled yet). Once supported use var supportedContent = jquery(".content");
        var supportedContent = jquery(".content[data-type!='Group']").filter(".content[data-type!='User']");

        // Show the tooltips
        jquery(".hideToolTipOption").css("visibility", "visible");

        // Highlight supported content.
        supportedContent.addClass("data-toggle btn-info");
        supportedContent.removeAttr("disabled");
        supportedContent.attr("data-toggle", "button");

        // Add a message to guide the user to select items
        var selectMsgHtml = jquery("#selectItemTemplate").html();
        jquery("#dropArea").html(selectMsgHtml);

        // Add a listener for clicking on content buttons.
        jquery(".content").click(function(event) {
            var owner;
            var folder;

            // Display the selected item's URL.
            var id = jquery(this).attr("data-id");

            var datatype = jquery(this).attr("data-type");
            var portal = app.portals.sourcePortal;

            // Highlight Web Maps.
            if (!isMultipleSelectionMode()) {
                // single delete item operation not allowed
            } else  {
                // in multiple selection mode, so only toggle the class that was clicked
                toggleContentEntry(jquery(this));

                // TODO: add shift-click control here to highlight intermediate entries when in multiple select mode
                if (event.shiftKey) {
                    // debugging only
                    console.warn("Shift-click select is experimental and will exhibit unexpected behavior.");

                    // TODO: Instead of making it the intermediate nodes, make it select all items
                    // between the previously clicked item and then newly clicked one.
                    var intermediateNodes = jquery(".content.btn-primary").first().nextUntil(this);
                    intermediateNodes.removeClass("btn-info");
                    intermediateNodes.addClass("btn-primary active");
                }

                // Update the selected item count.
                updateSelectedCount(jquery(this));
            }

            if (isMultipleSelectionMode() && event.shiftKey) {
                id = jquery.map(jquery(".content.btn-primary"), function (element){
                  return element.id;
                });
            }

            var html = jquery("#deleteContentTemplate").html();

            // Add the HTML container with the item JSON.
            jquery("#dropArea").html(html);

            // un-highlight the "delete selected" button if none are selected
            if (jquery(".content.btn-primary").length === 0) {
                jquery("#btnDeleteItems").removeClass("btn-primary");
            } else {
                jquery("#btnDeleteItems").addClass("btn-primary");
            }

            // Event listener for delete button.
            jquery("#btnDeleteItems").click(function() {

                // if no items are selected, then do nothing
                if (jquery(".content.btn-primary").length === 0) {
                    alert("First select items to delete"); // switch this to a bootstrap error panel that hovers
                    return;
                }

                var deleteInfoObject = {};
                jquery(".content.active[data-id]").each(function(index, el) {
                    var owner = jquery(this).attr("data-owner");
                    var deletionsForOwner = deleteInfoObject[owner];
                    if (deletionsForOwner) {
                        deletionsForOwner.push(jquery(this).attr("data-id"));
                        deleteInfoObject[owner] = deletionsForOwner;
                    } else {
                        deleteInfoObject[owner] = [jquery(this).attr("data-id")];
                    }
                });
                
                var itemDeleteRequests = [];
                jquery.each(deleteInfoObject, function( owner, deleteIds ) {
                    itemDeleteRequests.push(portal.deleteItems(owner, deleteIds));
                });

                jquery.when.apply(jquery, itemDeleteRequests).then(function(results) {
                        if(arguments.length > 0) {
                            if (jquery.isArray(arguments[0]) && arguments[0].length && arguments[0][1] === "success") {
                                // Debugging only
                                console.debug("An array of results was returned to handle multiple items");
                            }
                        }
                        return arguments;
                }).done(function(composedResults) {
                        if (composedResults[0].error) {
                            alert("Error deleting items: " + composedResults[0].error.message); // switch this to a bootstrap error panel that hovers
                        } else {

                            var deletedMessages = composedResults[0].results;
                            jquery.each(deletedMessages, function( key, value) {
                                if (value.success) {
                                    // updateSelectedCount()
/*                                    var updateSelectedCount = function(folderElement) {
                                        "use strict";

                                        // Update the selection count
                                        var selectedCount = jquery(".content.btn-primary").length;
                                        var parentFolderBadge = folderElement.parents("div.panel.panel-primary").find(".badge");
                                        var existingCount = parentFolderBadge.text();

                                        // TODO: Fix count here
                                        parentFolderBadge.text(selectedCount + " / " + parentFolderBadge.attr("data-originalcount"));
                                    };*/

                                    var el = jquery(".content.active[data-id='" + value.itemId +"']");
                                    console.debug("el:::", el);
                                    updateSelectedCount(el, -1, -1);

                                    jquery(".content.active[data-id='" + value.itemId +"']").remove();
                                } else {
                                    jquery(".content.active[data-id]").removeClass("btn-primary", "active").addClass("btn-danger");
                                }
                            });
                        }
                });

            // Here, using the id just optionall add it to a list on the right hand side to keep track of all that will be deleted
            });
        });
    };

    var highlightSupportedContent = function() {
        // Highlight content supported by the currently selected action.
        switch (jquery("#actionDropdown li.active").attr("data-action")) {
            case "copyContent":
                highlightCopyableContent();
                break;
            case "updateWebmapServices":
                cleanUp();
                updateWebmapServices();
                break;
            case "addRemoveContentTags":
                cleanUp();
                highlightUpdateTagsContent();
                break;
            case "updateProtection":
                cleanUp();
                highlightUpdateProtectionContent();
                break;
            case "deleteContent":
                cleanUp();
                highlightDeleteContent();
                break;
            case "updateContentUrl":
                cleanUp();
                updateContentUrls();
                break;
            case "exportSearchResultsToCSV":
                cleanUp();
                highlightExportSearchResultsToCSV();
                break;
            case "bulkReassignOwnership":
                cleanUp();
                highlightReassignOwnershipContent();
                break;
            case "bulkCopyContent":
                highlightBulkCopyableContent();
                break;
            case "inspectContent":
                cleanUp();
                inspectContent();
                break;
            case "testRegisteredServices":
                cleanUp();
                testRegisteredServices();
                break;
        }
    };

    /**
     * isSupported() returns true if the content type is supported
     * @type (String) type
     * @return (Boolean)
     * List of types available here: http://resources.arcgis.com/en/help/arcgis-rest-api/index.html#//02r3000000ms000000
     */
    var isSupported = function(type) {
        // Check if the content type is supported.
        //
        var supportedTypes = [
            "Web Map",
            "Web Scene",
            "Map Service",
            "Image Service",
            "Scene Service",
            "WMS",
            "Feature Collection",
            "Feature Collection Template",
            "Geodata Service",
            "Globe Service",
            "Geometry Service",
            "Geocoding Service",
            "Network Analysis Service",
            "Geoprocessing Service",
            "Web Mapping Application",
            "Mobile Application",
            "Operation View",
            "Symbol Set",
            "Color Set",
            "Document Link",
            "Feature Service"
        ];
        if (jquery.inArray(type, supportedTypes) > -1) {
            return true;
        }
    };

//    var isTypeText = function(type) {
//        var textTypes = [
//            "Web Map",
//            "Feature Collection",
//            "Feature Collection Template",
//            "Operation View",
//            "Symbol Set",
//            "Color Set",
//            "Document Link"
//        ];
//        if (jquery.inArray(type, textTypes) > -1) {
//            return true;
//        }
//    };
//
//    var isTypeUrl = function(type) {
//        var urlTypes = [
//            "Feature Service",
//            "Map Service",
//            "Image Service",
//            "KML",
//            "WMS",
//            "Geodata Service",
//            "Globe Service",
//            "Geometry Service",
//            "Geocoding Service",
//            "Network Analysis Service",
//            "Geoprocessing Service",
//            "Web Mapping Application",
//            "Mobile Application"
//        ];
//        if (jquery.inArray(type, urlTypes) > -1) {
//            return true;
//        }
//    };

    var listSearchUsers = function(portalUrl, results) {
        "use strict";
        clearResults();

        var folderData = {
            title: "Search Results (" + results.query + ")",
            id: "search",
            count: results.total
        };
        var html = mustache.to_html(jquery("#folderTemplate").html(), folderData);
        jquery("#itemsArea").append(html);

        // Append the root items to the Root folder.
        jquery.each(results.results, function() {
            var templateData = {
                id: this.username,
                includeTooltip: true,
                title: this.username,
                fullname: this.fullName,
                modified: formatDate(new Date(this.modified)),
                created: formatDate(new Date(this.created)),
                itemmetadata: JSON.stringify(this).split("\"").join("&quote;"), // replace all quotes
                tags: this.tags,
                tooltipText: {tags: this.tags.join(", "), access: this.access, id: this.id},
                type: "User",
                icon: portalInfo.items("User").icon,
                portal: portalUrl
            };
            var html = mustache.to_html(jquery("#contentTemplate").html(), templateData);
            jquery("#collapse_search").append(html).addClass("in");
        });

        //TODO: nath4868 tooltips not working here in FF?
        // Show tooltips
        //jquery('[data-toggle="tooltip"]').tooltip({"trigger":"hover click", "container": "body", "html": true, "selector": ".contentToolTip"});
        jquery('[data-toggle="tooltip"]').tooltip({"trigger":"hover click", container: "body", html: true});

        highlightSupportedContent();
    };

    var listSearchGroups = function(portalUrl, results) {
        "use strict";
        clearResults();

        var folderData = {
            title: "Search Results (" + results.query + ")",
            id: "search",
            count: results.total
        };
        var html = mustache.to_html(jquery("#folderTemplate").html(), folderData);
        jquery("#itemsArea").append(html);

        // Append the root items to the Root folder.
        jquery.each(results.results, function() {
            var templateData = {
                id: this.id,
                includeTooltip: true,
                title: this.title,
                owner: this.owner,
                modified: formatDate(new Date(this.modified)),
                created: formatDate(new Date(this.created)),
                itemmetadata: JSON.stringify(this).split("\"").join("&quote;"), // replace all quotes
                tags: this.tags,
                tooltipText: {tags: this.tags.join(", "), access: this.access, id: this.id},
                type: "Group",
                icon: portalInfo.items("Group").icon,
                portal: portalUrl
            };
            var html = mustache.to_html(jquery("#contentTemplate").html(), templateData);
            jquery("#collapse_search").append(html).addClass("in");
        });

        // Show tooltips
        jquery('[data-toggle="tooltip"]').tooltip({"trigger":"hover click", container: "body", html: true});

        highlightSupportedContent();
    };

    var formatDate = function(date) {
            var dd = date.getDate();
            var mm = date.getMonth() + 1;
            var yyyy = date.getFullYear();
            return mm + "/" + dd + "/" + yyyy;
    };

    var listSearchItems = function(portalUrl, results) {
        "use strict";
        clearResults();

        // TODO: Add organization header to here
        var folderData = {
            title: "Search Results (" + results.query + ")",
            id: "search",
            count: results.total
        };
        var html = mustache.to_html(jquery("#folderTemplate").html(), folderData);
        jquery("#itemsArea").append(html);

        console.debug("results.results.length::::", results.results.length);

        var countindex = 0; // for testing only

        // Append the root items to the Root folder.
        jquery.each(results.results, function() {
            var templateData = {
                id: this.id,
                includeTooltip: true,
                countindex: countindex++, // for testing only
                title: this.title,
                owner: this.owner,
                modified: formatDate(new Date(this.modified)),
                created: formatDate(new Date(this.created)),
                itemmetadata: JSON.stringify(this).split("\"").join("&quote;"), // replace all quotes
                tags: this.tags,
                tooltipText: {tags: this.tags.join(", "), access: this.access, id: this.id},
                type: this.type,
                icon: portalInfo.items(this.type).icon,
                portal: portalUrl
            };
            var html = mustache.to_html(jquery("#contentTemplate").html(), templateData);
            jquery("#collapse_search").append(html).addClass("in");
        });

        // Show Tooltips
        jquery('[data-toggle="tooltip"]').tooltip({"trigger":"hover click", container: "body", html: true});

        highlightSupportedContent();
    };

    var listUserItems = function() {
        "use strict";
        var portal = app.portals.sourcePortal;

        cleanUp();
        clearResults();

        // Capture item creation times to be displayed in the user heatmap.
        function storeActivity(activityTime) {
            var seconds = activityTime / 1000;
            app.stats.activities[seconds] = 1;
        }

        function sortFoldersAlpha(container) {
            var folders = container.children(".panel").get();
            folders.sort(function(a, b) {
                return jquery(a).children("div.panel-heading").attr("data-title").toUpperCase().localeCompare(jquery(b).children("div.panel-heading").attr("data-title").toUpperCase());
            });

            jquery.each(folders, function(idx, folder) {
                container.append(folder);
            });

            container.prepend(jquery("[data-title='Root']").parent());
        }

        function sortItemsAlpha(folder) {
            var folderItems = folder.children("button").get();
            folderItems.sort(function(a, b) {
                return jquery(a).text().toUpperCase().localeCompare(jquery(b).text().toUpperCase());
            });

            jquery.each(folderItems, function(idx, item) {
                folder.append(item);
            });
        }

        portal.userContent(portal.username, "/").done(function(content) {
            // Append the root folder accordion.
            var folderData = {
                title: "Root",
                id: "",
                count: content.items.length
            };
            var html = mustache.to_html(jquery("#folderTemplate").html(), folderData);
            jquery("#itemsArea").append(html);

/*
                id: this.id,
                countindex: countindex++, // for testing only
                title: this.title,
                owner: this.owner,
                modified: formatDate(new Date(this.modified)),
                created: formatDate(new Date(this.created)),
                itemmetadata: JSON.stringify(this).split("\"").join("&quote;"), // replace all quotes
                tags: this.tags,
                tooltipText: {tags: this.tags.join(", "), access: this.access, id: this.id},
                type: this.type,
                icon: portalInfo.items(this.type).icon,
                portal: portalUrl
*/


            console.debug("content.items here:", content.items);

            // Append the root items to the Root folder.
            jquery.each(content.items, function(item) {

                console.debug("this here::::", this);
                var templateData = {
                    id: this.id,
                    includeTooltip: true,
                    title: this.title,
                    tooltipText: {tags: this.tags.join(", "), access: this.access, id: this.id},
                    type: this.type,
                    icon: portalInfo.items(this.type).icon,
                    portal: portal.portalUrl
                };
                var html = mustache.to_html(jquery("#contentTemplate").html(), templateData);
                jquery("#collapse_").append(html);
                storeActivity(content.items[item].modified);
            });

            // Show tooltips
            jquery('[data-toggle="tooltip"]').tooltip({"trigger":"hover click", container: "body", html: true});

            sortItemsAlpha(jquery("#collapse_"));
            jquery.each(content.folders, function(folder) {
                sortFoldersAlpha(jquery("#itemsArea"));
                portal.userContent(portal.username, content.folders[folder].id)
                    .done(function(content) {
                        var folderData = {
                            title: content.currentFolder.title,
                            id: content.currentFolder.id,
                            count: content.items.length
                        };

                        // Append an accordion for the folder.
                        var html = mustache.to_html(jquery("#folderTemplate").html(), folderData);
                        jquery("#itemsArea").append(html);

                        // Append the items to the folder.
                        jquery.each(content.items, function(item) {
                            var templateData = {
                                id: this.id,
                                includeTooltip: true,
                                title: this.title,
                                tooltipText: {tags: this.tags.join(", "), access: this.access, id: this.id},
                                type: this.type,
                                icon: portalInfo.items(this.type).icon,
                                portal: portal.portalUrl
                            };
                            var html = mustache.to_html(jquery("#contentTemplate").html(), templateData);
                            jquery("#collapse_" + content.currentFolder.id).append(html);
                            storeActivity(content.items[item].modified);
                        });

                        // Show tooltips
                        jquery('[data-toggle="tooltip"]').tooltip({"trigger":"hover click", container: "body", html: true});

                        sortItemsAlpha(jquery("#collapse_" + content.currentFolder.id));
                    });
            });

            setTimeout(function() {
                // Wait a second to let all of the items populate before sorting and highlighting them.
                sortFoldersAlpha(jquery("#itemsArea"));
                highlightSupportedContent();
            }, 1000);
        });
    };

    var showDestinationFolders = function() {
        "use strict";
        var portal = app.portals.destinationPortal;

        function sortItemsAlpha(folder) {
            var folderItems = folder.children("button").get();
            folderItems.sort(function(a, b) {
                return jquery(a).text().toUpperCase().localeCompare(jquery(b).text().toUpperCase());
            });

            jquery.each(folderItems, function(idx, item) {
                folder.append(item);
            });
        }

        portal.userContent(portal.username, "/").done(function(content) {
            var folderData = {
                title: "Root",
                id: "",
                count: content.items.length
            };

            // Append the root folder accordion.
            var html = mustache.to_html(jquery("#dropFolderTemplate").html(),
                folderData
            );
            jquery("#dropArea").append(html);

            // Append the root items to the Root folder.
            jquery.each(content.items, function() {
                var templateData = {
                    id: this.id,
                    title: this.title,
                    type: this.type,
                    icon: portalInfo.items(this.type).icon,
                    portal: portal.portalUrl
                };
                var html = mustache.to_html(jquery("#contentTemplate").html(), templateData);
                jquery("#collapseDest_").append(html);
            });

            sortItemsAlpha(jquery("#collapseDest_"));

            // Enable the droppable area.
            makeDroppable("");

            // Append the other folders.
            jquery.each(content.folders, function(folder) {
                portal.userContent(portal.username, content.folders[folder].id)
                    .done(function(content) {
                        var folderData = {
                            title: content.currentFolder.title,
                            id: content.currentFolder.id,
                            count: content.items.length
                        };

                        // Append an accordion for the folder.
                        var template = jquery("#dropFolderTemplate").html();
                        var html = mustache.to_html(template, folderData);
                        jquery("#dropArea").append(html);

                        // Append the items to the folder.
                        jquery.each(content.items, function() {
                            var templateData = {
                                id: this.id,
                                title: this.title,
                                type: this.type,
                                icon: portalInfo.items(this.type).icon,
                                portal: portal.portalUrl
                            };
                            var html = mustache.to_html(jquery("#contentTemplate").html(), templateData);
                            jquery("#collapseDest_" + content.currentFolder.id).append(html);
                        });

                        // Collapse the accordion to avoid cluttering the display.
                        jquery("#collapseDest_" + content.currentFolder.id)
                            .collapse("hide");
                        sortItemsAlpha(jquery("#collapseDest_" + content.currentFolder.id));

                        // Enable the droppable area.
                        makeDroppable(content.currentFolder.id);
                    });
            });
        });
    };

    var composeFilter = function(searchLocation, searchType, searchField, searchOperator, searchValue) {
        "use strict";

        var query = searchValue;
        switch (searchField) {
            case "Title":
                if (searchType === "groups") {
                    query = "(title:\"" + searchValue + "\")";
                } else if (searchType === "users") {
                    query = "(username:\"" + searchValue + "\")";
                } else {
                    query = "(title:\"" + searchValue + "\" OR title:" + searchValue + "*)";
                }

                //query = "(title:\"" + searchValue + "\" OR title:*\"" + searchValue + "\")";
                //query = "(title:\"" + searchValue + "\" OR \"" + searchValue + "\"* OR *\"" + searchValue + "\")";
                //query = "(title:\"" + searchValue + "\" OR title:\"" + searchValue + "*\" OR title:\"*" + searchValue + "\")";
                //query = "(title:\"" + searchValue + "\"*)";
                break;
            case "Username":
                if (searchOperator === "contains") {
                    query = "(username:" + searchValue + "*)";
                } else if (searchOperator === "not") {
                    query = "(-username:\"" + searchValue + "\")";
                } else {
                    query = "(username:\"" + searchValue + "\")";
                }
                break;
            case "Full Name":
                if (searchOperator === "contains") {
                    // TODO: split space-separated terms and put asterisks after each?
                    query = "(fullname:" + searchValue + "*)";
                } else if (searchOperator === "not") {
                    query = "(-fullname:\"" + searchValue + "\")";
                } else {
                    query = "(fullname:\"" + searchValue + "\")";
                }
                break;
            case "Access":
                console.warn("Access search case not implemented.");
                break;
            case "Description":
                console.warn("Description search case.");
                break;
            case "Group":
                console.warn("Group search case not implemented.");
                break;
            case "Last":
                console.warn("Last search case not implemented.");
                break;
            case "Owner":

                if (searchOperator === "not") {
                    query = "orgid:" + app.portalSelfData.user.orgId + " AND -owner:" + searchValue;
                } else {
                    query = "orgid:" + app.portalSelfData.user.orgId + " AND owner:" + searchValue;
                }
                break;
            case "Tag":
                if (searchOperator === "not") {
                    query = "-tags:\"" + searchValue + "\"";
                } else {
                    query = "tags:\"" + searchValue + "\"";
                    //query = "(tags:\"" + searchValue + "\" OR tags:" + searchValue + "*)";
                }
                break;
            case "Type":
                // TODO: add negations for all other types? Use portalInfo.allitems() to get the list?
                if (searchOperator === "not") {
                    query = "-type:\"" + searchValue + "\"";
                } else {
                    query = "type:\"" + searchValue + "\" AND -type:\"Web Mapping Application\"";
                }
                break;
            case "Type Keywords":
                console.warn("Type Keywords search case not implemented.");
                break;
            case "Uploaded":
                console.warn("Uploaded search case not implemented.");
                break;
            case "Last Modified":
                var unixPortalTime = "000000" + new Date(searchValue).getTime();
                if (searchOperator === "before") {
                   query = "modified:[0000000000000000000 TO " + unixPortalTime + "]";
                } else if (searchOperator === "after") {
                    query = "modified:[" + unixPortalTime + " TO " + new Date().getTime() + "]";
                } else {
                    console.error("Search operator '" + searchOperator + "' not supported currently.");
                }
                break;
            default:
                console.error("Search field '" + searchField + "' not implemented in advanced search.");
        }

        if (searchLocation === "org") { // Add the org id for "My Portal" searches.
            query = "accountid:" + jquery("#advancedSearchModal .advanced-search-location.active").attr("data-id")  + " AND " + query;
        } else if (searchLocation === "mycontent") { // Add the username for "My Content" searches.
            query = "owner:" + app.portals.sourcePortal.username + " AND " + query;
        }

        return query;
    };

    var isMultipleSelectionMode = function() {
        "use strict";

        switch (jquery("#actionDropdown li.active").attr("data-action")) {
            // mutiple selection operations
            case "addRemoveContentTags": return true;
            case "updateProtection": return true;
            case "deleteContent": return true;
            case "exportSearchResultsToCSV": return true;
            case "bulkCopyContent": return true;
            case "bulkReassignOwnership": return true;

            // single selection
            case "copyContent": return false;
            case "updateWebmapServices": return false;
            case "updateContentUrl": return false;
            case "inspectContent": return false;
        }

        // If it isn't a detected action assume it is single mode
        return false;
    };

    var toggleContentEntry = function(contentElement) {
        "use strict";

        if (contentElement.hasClass("btn-primary")) {
            contentElement.removeClass("btn-primary");
            contentElement.addClass("btn-info");
        } else {
            contentElement.addClass("btn-primary");
            contentElement.removeClass("btn-info");
        }
    };

    var updateSelectedCount = function(folderElement, selectedChange, totalChange) {
        "use strict";

        // Update the selection count
        var selectedCount = jquery(".content.btn-primary").length;
        if (selectedChange) {
            selectedCount = selectedCount + selectedChange;
        }
        var parentFolderBadge = folderElement.parents("div.panel.panel-primary").find(".badge");
        if (totalChange) {
            try {
                var originalCount = parentFolderBadge.attr("data-originalcount");
                var newCount = parseInt(originalCount) + totalChange;
                parentFolderBadge.attr("data-originalcount", newCount);
            } catch (err) {
                // ignore
            }
        }
        //var existingCount = parentFolderBadge.text();

        // TODO: Fix count here
        parentFolderBadge.text(selectedCount + " / " + parentFolderBadge.attr("data-originalcount"));
    };

    // Do stuff when the DOM is ready.
    jquery(document).ready(function() {

        // Load the html templates.
        jquery.get("templates.html", function(templates) {
            jquery("body").append(templates);

            // Enable the login button.
            // Doing it here ensures all required libraries have loaded.
            jquery(".jumbotron > p > [data-action='login']")
                .removeAttr("disabled");
            jquery("a.portal-signin").attr("href", "#portalLoginModal");

            // Restore previous ArcGIS Online login if it was deleted
            // during interrupted destination login.
            if (sessionStorage.esriJSAPIOAuthBackup && sessionStorage.esriIdBackup) {
                esriId.destroyCredentials();
                esriId.initialize(JSON.parse(sessionStorage.getItem("esriIdBackup")));
                sessionStorage.setItem("esriJSAPIOAuth", sessionStorage.getItem("esriJSAPIOAuthBackup"));
            }

            // Check for previously authenticated sessions.
            esriId.registerOAuthInfos([appInfo]);
            esriId.checkSignInStatus(appInfo.portalUrl)
                .then(
                    function(user) {
                        jquery("#splashContainer").css("display", "none");
                        jquery("#itemsContainer").css("display", "block");
                        app.portals.sourcePortal = new portalSelf.Portal({
                            portalUrl: user.server + "/",
                            username: user.userId,
                            token: user.token
                        });
                        startSession();
                    })
                .otherwise(
                    function() {
                        jquery("#itemsContainer").css("display", "none");
                        jquery("#splashContainer").css("display", "block");
                    }
                );
        });

        // Resize the content areas to fill the window.
        var resizeContentAreas = function() {
            "use strict";
            jquery(".itemArea").height(jquery(window).height() - 50);
        };

        resizeContentAreas();

        // Disable the enter key to prevent accidentally firing forms.
        // Disable it for everything except the code edit windows.
        var disableEnterKey = function() {
            "use strict";
            jquery("html").bind("keypress", function(e) {
                if (e.keyCode === 13 && jquery(e.target).attr("contenteditable") !== "true" && !jquery(e.target).parent().hasClass("bootstrap-tagsinput")) {
                    return false;
                } else {
                    // Debugging only
                    //console.debug("skipping keypress suppression:", e);
                }
            });
        };

        disableEnterKey();

        // Preformat the copy login screen.
        jquery("#destinationAgolBtn").button("toggle");
        jquery("#destinationAgolBtn").addClass("btn-primary");
        jquery("#destinationUrl").css({
            display: "none"
        });
        jquery("#destinationWebTierAuth").css({
            display: "none"
        });
        jquery("#destinationLoginForm").css({
            display: "none"
        });

        // *** Global Listeners ***
        jquery("#destinationAgolBtn").click(function() {
            jquery(".alert-danger.alert-dismissable").remove();
            jquery("#destinationUrl").next().removeClass("glyphicon-ok");
            jquery("#destinationUrl").parent().removeClass("has-error");
            jquery("#destinationUrl").attr({
                placeholder: "",
                value: "https://www.arcgis.com/"
            });
            jquery("#destinationUrl").val("https://www.arcgis.com/");
            jquery("#destinationUrl").css({
                display: "none"
            });
            jquery("#destinationWebTierAuth").css({
                display: "none"
            });
            jquery("#destinationLoginForm").css({
                display: "none"
            });
            jquery("#destinationLoginBtn").css({
                display: "none"
            });
            jquery("#destinationEnterpriseBtn").css({
                display: "inline"
            });
            jquery("#destinationAgolBtn").addClass("btn-primary active");
            jquery("#destinationPortalBtn").removeClass("btn-primary active");
            if (app.portals.destinationPortal) {
                app.portals.destinationPortal.portalUrl = "https://www.arcgis.com/";
            }
        });

        jquery("#destinationPortalBtn").click(function() {
            jquery("#destinationUrl").attr({
                placeholder: "https://myportal.com/",
                value: ""
            });
            jquery("#destinationUrl").val("");
            jquery("#destinationUrl").css({
                display: "block"
            });
            jquery("#destinationWebTierAuth").css({
                display: "block"
            });
            jquery("#destinationLoginForm").css({
                display: "block"
            });
            jquery("#destinationLoginBtn").css({
                display: "inline"
            });
            jquery("#destinationEnterpriseBtn").css({
                display: "none"
            });
            jquery("#destinationPortalBtn").addClass("btn-primary active");
            jquery("#destinationAgolBtn").removeClass("btn-primary active");
        });

        // Make DOM adjustments when the browser is resized.
        jquery(window).resize(function() {
            resizeContentAreas();
        });

        // Validate the entered url when the input loses focus.
        jquery("#portalUrl").blur(function() {

            if (!app.portals.sourcePortal) {
                app.portals.sourcePortal = new portalSelf.Portal();
            }

            // Give the DOM time to update before firing the validation.
            setTimeout(function() {
                validateUrl("#portalUrl", app.portals.sourcePortal);
            }, 500);
        });

        // Validate the url when the input loses focus.
        jquery("#destinationUrl").blur(function() {

            if (!app.portals.destinationPortal) {
                app.portals.destinationPortal = new portalSelf.Portal();
            }

            // Give the DOM time to update before firing the validation.
            setTimeout(function() {
                if (jquery("#destinationPortalBtn").hasClass("active")) {
                    validateUrl("#destinationUrl", app.portals.destinationPortal);
                }
            }, 500);
        });

        // Disable username and password if web tier auth is selected.
        jquery("#sourceWebTierAuth").click(function(e) {
            var checkboxState = jquery(e.currentTarget).prop("checked");
            if (checkboxState === true) {
                jquery("#portalUsername").attr("disabled", true);
                jquery("#portalPassword").attr("disabled", true);
                jquery("#portalLoginBtn").text("Proceed");
                app.portals.sourcePortal.withCredentials = true;
            } else {
                jquery("#portalUsername").removeAttr("disabled");
                jquery("#portalPassword").removeAttr("disabled");
                jquery("#portalLoginBtn").text("Log in");
                app.portals.sourcePortal.withCredentials = false;
            }
        });

        // Disable username and password if web tier auth is selected.
        jquery("#destWebTierAuthChk").click(function(e) {
            var checkboxState = jquery(e.currentTarget).prop("checked");
            if (checkboxState === true) {
                jquery("#destinationUsername").attr("disabled", true);
                jquery("#destinationPassword").attr("disabled", true);
                jquery("#destinationLoginBtn").text("Proceed");
                app.portals.destinationPortal.withCredentials = true;
            } else {
                jquery("#destinationUsername").removeAttr("disabled");
                jquery("#destinationPassword").removeAttr("disabled");
                jquery("#destinationLoginBtn").text("Log in");
                app.portals.destinationPortal.withCredentials = false;
            }
        });

        // Login.
        jquery("[data-action='login']").click(function() {
            esriId.getCredential(appInfo.portalUrl, {
                    oAuthPopupConfirmation: false
                })
                .then(function(user) {
                    jquery("#splashContainer").css("display", "none");
                    jquery("#itemsContainer").css("display", "block");
                    app.portals.sourcePortal = new portalSelf.Portal({
                        portalUrl: user.server + "/",
                        username: user.userId,
                        token: user.token
                    });
                    startSession();
                });
        });

        // Destination ArcGIS Online login.
        jquery("[data-action='logindestination']").click(function() {

            // Save esriId and esriJSAPIOAuth to restore after logging in
            var appIdJson = esriId.toJson();
            var esriJSAPIOAuth = sessionStorage.esriJSAPIOAuth;

            // Store backup in case page is refreshed in the middle of logging in
            sessionStorage.setItem("esriJSAPIOAuthBackup", esriJSAPIOAuth);
            sessionStorage.setItem("esriIdBackup", JSON.stringify(appIdJson));

            // Destroy credentials and remove esriJSAPIOAuth sessions storage
            esriId.destroyCredentials();
            sessionStorage.removeItem("esriJSAPIOAuth");

            esriId.getCredential(appInfo.portalUrl, {
                oAuthPopupConfirmation: false
            }).then(function(user) {
                // If there is no destination or the destination is not the same as ArcGIS Online
                if (!app.portals.destinationPortal || (app.portals.destinationPortal.portalUrl !== appInfo.portalUr)) {
                    app.portals.destinationPortal = new portalSelf.Portal({
                        portalUrl: user.server + "/",
                        username: user.userId,
                        token: user.token
                    });
                }

                // Re-hydrate identify manager and restore session storage of esriJSAPIOAuth
                esriId.initialize(appIdJson);
                sessionStorage.setItem("esriJSAPIOAuth", esriJSAPIOAuth);

                app.portals.destinationPortal.self().done(function(data) {
                    jquery("#copyModal").modal("hide");
                    highlightCopyableContent();
                    NProgress.start();
                    showDestinationFolders();
                    NProgress.done();
                });
            }, function error(err) {

                console.error("There was an error retrieving credentials:", err);
            });
        });

        // Log into a Portal.
        jquery("#portalLoginBtn").click(function() {
            loginPortal();
        });

        /**
         * Use the existing credentials when "My Account"
         * is selected as the copy target.
         */
        jquery("[data-action='copyMyAccount']").click(function() {
            if(jquery("[data-action='bulkCopyContent']").hasClass("active")) {
                app.portals.destinationPortal = app.portals.sourcePortal;
                jquery("#copyModal").modal("hide");
                highlightBulkCopyableContent();
                NProgress.start();
                showDestinationFolders();
                NProgress.done();
            } else {
                app.portals.destinationPortal = app.portals.sourcePortal;
                jquery("#copyModal").modal("hide");
                highlightCopyableContent();
                NProgress.start();
                showDestinationFolders();
                NProgress.done();
            }
        });

        /**
         * Show other destination form when "Another Account"
         * is selected as the copy target.
         */
        jquery("[data-action='copyOtherAccount']").click(function() {
            jquery("#destinationChoice").css("display", "none");
            jquery("#destinationForm").css("display", "block");
        });

        // Log in to the destination account.
        jquery("#destinationLoginBtn").click(function() {
            loginDestination();
        });

        // Reset the destination login form when the modal is canceled.
        jquery("#destinationLoginBtn").click(function() {
            jquery("#destinationLoginBtn").button("reset");
        });

        // Clear the copy action when the cancel button is clicked.
        jquery("#destinationCancelBtn").click(function() {
            jquery("#actionDropdown li").removeClass("active");
        });

        // Add a listener for the enter key on the destination login form.
        jquery("#destinationLoginForm").keypress(function(e) {
            if (e.which == 13) {
                jquery("#destinationLoginBtn").focus().click();
            }
        });

        /* The below section is for a select all/none menu option for the folders.
         * Currently this is not fully implemented yet so #folderTemplate has that
         * part commented out in templates.html and the below code is not active.
         */
        // Add a listener for select all/none clicks.
        // TODO: rewrite this for a smaller scope.
/*        jquery(document).on('click', '.dropdown-menu li a', function () {
            console.log("Selected Option: " + jquery.trim(jquery(this).text()));

            var items = jquery(this).closest(".panel.panel-primary").find('.content');
            if (jquery(this).text() === "All") {
                items.addClass("btn-primary active");
                items.removeClass("btn-info");
            } else {
                items.removeClass("btn-primary active");
                items.addClass("btn-info");
            }
        });*/

        // Add a listener for the future search bar picker.
        jquery(document).on("click", "#searchMenu li", function(e) {
            var selectedAction = jquery(e.target).parent().attr("data-action");
            if (selectedAction == "advancedSearch") {

                var advancedSearchModal = jquery("#advancedSearchModal");
                if (advancedSearchModal.length === 0) {
                        var template = jquery("#advancedSearchTemplate").html();

                        console.debug("app.portalSelfData for advancedsearch mixin:", app.portalSelfData);

                        advancedSearchModal = mustache.to_html(template, {portalSelfData: app.portalSelfData, showArcGISOnline: !app.hideArcGISOnline});
                        jquery("body").append(advancedSearchModal);

                        // Trigger popovers tooltip.
                        // TODO: see if this is still used
                        jquery('[data-toggle="popover"]').popover({html: true}); 

                        jquery(".advanced-search-location").removeClass("btn-primary active");

                        // Add the active tag to either the AGO, Portal, or My Content button (in that order of precedence)
                        if (!app.hideArcGISOnline) {
                            jquery("#advancedSearchAGO").addClass("btn-primary active");
                        } else {
                            if (app.portalSelfData.name) {
                                jquery("#advancedSearchOrg").addClass("btn-primary active");
                            } else {
                                jquery("#advancedSearchMyContent").addClass("btn-primary active");
                            }
                        }

                        jquery(".advanced-search-type").removeClass("btn-primary active");
                        jquery("#advancedSearchItems").addClass("btn-primary active");

                        // Changing the search location.
                        jquery(".advanced-search-location").click(function(event) {
                            // TODO: Add here to clear the existing query and reset what fields can be searched?
                            jquery(".advanced-search-location").removeClass("btn-primary active");
                            jquery(event.target).addClass("btn-primary active");
                        });

                        // TODO: nath4868 this function will build out all the dropdown values correctly
                        var setupFilterDropdowns = function(e) {
                            "use strict";

                            var portal = app.portals.sourcePortal;
                            var inputElementStr;

                            // remove the available operators first
                            var operatorInput = jquery("#filterOpInput").find("option").remove().end();

                            // destroy the previous search value typeahead so it can be correctly replaced or recreated
                            jquery("#searchValue").typeahead("destroy");

                            // find the selected attribute from the dropdown and add
                            // the operands appropriate for filtering that attribute
                            var attributeSelected;
                            if (e && e.target) {
                                attributeSelected = jquery(e.target).val();
                            } else {
                                attributeSelected = jquery("#filterAttributeInput").val();
                            }
                            
                            if (attributeSelected === "Title") {
                                operatorInput.append('<option value="contains">contains</option>')
                                    .append('<option value="not">is not</option>')
                                    .val("contains");

                                    jquery("#searchValue").replaceWith("<input type=\"text\" class=\"form-control\" id=\"searchValue\">");

                            } else if(attributeSelected === "Username") {
                                operatorInput.append('<option value="contains">contains</option>')
                                    .append('<option value="is">is exactly</option>').append('<option value="not">is not</option>')
                                    .val("contains");

                                    jquery("#searchValue").replaceWith("<input type=\"text\" class=\"form-control\" id=\"searchValue\">");

                            } else if (attributeSelected === "Full Name") {
                                operatorInput.append('<option value="contains">contains</option>')
                                    .append('<option value="is">is exactly</option>').append('<option value="not">is not</option>')
                                    .val("contains");

                                    jquery("#searchValue").replaceWith("<input type=\"text\" class=\"form-control\" id=\"searchValue\">");

                            } else if (attributeSelected === "Owner") {
                                operatorInput.append('<option value="is">is</option>')
                                    .append('<option value="not">is not</option>')
                                    .val("is");

                                    var substringMatcherOwner = function(strs) {
                                          return function findMatches(q, cb) {
                                            var matches, substrRegex;

                                            // an array that will be populated with substring matches
                                            matches = [];

                                            if (q.length === 0) {
                                                cb(strs);
                                            }

                                            // regex used to determine if a string contains the substring `q`
                                            substrRegex = new RegExp(q, 'i');

                                            // iterate through the pool of strings and for any string that
                                            // contains the substring `q`, add it to the `matches` array
                                            jquery.each(strs, function(i, str) {
                                              if (substrRegex.test(str)) {
                                                matches.push(str);
                                              }
                                            });

                                            cb(matches);
                                          };
                                    };


                                    inputElementStr = "<select class=\"form-control\" id=\"searchValue\">";
                                    // <option value="volvo">Volvo</option>

                                    portal = app.portals.sourcePortal;
                                    var userMatches = [];
                                    portal.portalUsers().done(function(data) {
                                        jquery.each(data.users, function(index, el) {
                                            userMatches.push(el.username);
                                        });

                                        jquery("#searchValue").replaceWith('<input class="form-control" type="text" id="searchValue" placeholder="Search Value" />');

                                        jquery('#searchValue').typeahead({
                                          hint: true,
                                          highlight: true,
                                          minLength: 0
                                        },
                                        {
                                          name: 'searchValue',
                                          source: substringMatcherOwner(userMatches),
                                          limit: Infinity
                                        });

                                    }).always(function() {
                                            inputElementStr = inputElementStr + "</select>";
                                    });

                            } else if (attributeSelected === "Tag") {
                                operatorInput.append('<option value="is">is</option>')
                                    .append('<option value="not">is not</option>')
                                    .val("is");

                                    //jquery("#searchValue").replaceWith("<input type=\"text\" class=\"form-control\" id=\"searchValue\">");

                                    var substringMatcher = function(strs) {
                                          return function findMatches(q, cb) {
                                            var matches, substrRegex;

                                            // an array that will be populated with substring matches
                                            matches = [];

                                            if (q.length === 0) {
                                                cb(strs);
                                            }

                                            // regex used to determine if a string contains the substring `q`
                                            substrRegex = new RegExp(q, 'i');

                                            // iterate through the pool of strings and for any string that
                                            // contains the substring `q`, add it to the `matches` array
                                            jquery.each(strs, function(i, str) {
                                              if (substrRegex.test(str)) {
                                                matches.push(str);
                                              }
                                            });

                                            cb(matches);
                                          };
                                    };

                                    inputElementStr = "<select class=\"form-control\" id=\"searchValue\">";

                                    portal = app.portals.sourcePortal;
                                    var matchesArray = [];
                                    portal.userTags(portal.username).done(function(data) {

                                        jquery.each(data.tags, function(index, el) {
                                            inputElementStr = inputElementStr + "<option value=\"" + el.tag + "\">" + el.tag + "</option>";
                                            matchesArray.push(el.tag);
                                        });

                                        jquery("#searchValue").replaceWith('<input class="form-control" type="text" id="searchValue" placeholder="Search Value" />');

                                        jquery('#searchValue').typeahead({
                                              hint: true,
                                              highlight: true,
                                              minLength: 0
                                        },{
                                              name: 'searchValue',
                                              source: substringMatcher(matchesArray),
                                              limit: Infinity
                                        });

                                    }).always(function(arg1) {
                                                //inputElementStr = inputElementStr + "</select>";
                                                //jquery("#searchValue").replaceWith(inputElementStr);
                                    });

                            } else if (attributeSelected === "Last Modified") {
                                operatorInput.append('<option value="before">before</option>')
                                    .append('<option value="after">after</option>')
                                    .val("before");

                                jquery("#searchValue").replaceWith("<input type=\"date\" class=\"form-control\" id=\"searchValue\">");

                            } else if (attributeSelected === "Type" ) {
                                operatorInput.append('<option value="is">is</option>')
                                    .append('<option value="not">is not</option>')
                                    .val("is");

                                var itemTypeOptionsTemplateHtml = jquery("#itemTypeDropdownOptions").html();
                                var itemTypeOptionsHtml = mustache.to_html(itemTypeOptionsTemplateHtml);
                                jquery("#searchValue").replaceWith(itemTypeOptionsHtml);
                                jquery("#searchValue").val("Web Map");
                            }
                        };

                        // Changing the search type.
                        jquery(".advanced-search-type").click(function(event) {
                            // TODO: Add here especially to clear the existing query and reset what fields can be searched?
                            jquery(".advanced-search-type").removeClass("btn-primary active");
                            jquery(event.target).addClass("btn-primary active");

                            var searchTypeSel = jquery(this).attr("data-action");
                            var operatorInput = jquery("#filterOpInput").find("option").remove().end();
                            if (searchTypeSel === "items") {
                                jquery("#filterAttributeInput").replaceWith("<select class=\"form-control\" id=\"filterAttributeInput\"><option>Title</option><option>Owner</option><option>Tag</option><option>Last Modified</option><option>Type</option></select>");
                                operatorInput.append('<option value="contains">contains</option>')
                                    .append('<option value="is">is exactly</option>').append('<option value="not">is not</option>')
                                    .val("contains");
                            } else if (searchTypeSel === "groups") {
                                jquery("#filterAttributeInput").replaceWith("<select class=\"form-control\" id=\"filterAttributeInput\"><option>Title</option><option>Owner</option><option>Tag</option><option>Last Modified</option></select>");
                                operatorInput.append('<option value="contains">contains</option>')
                                    .append('<option value="is">is exactly</option>').append('<option value="not">is not</option>')
                                    .val("contains");
                            } else if (searchTypeSel === "users") {
                                jquery("#filterAttributeInput").replaceWith("<select class=\"form-control\" id=\"filterAttributeInput\"><option>Username</option><option>Full Name</option><option>Tag</option></select>");
                                 operatorInput.append('<option value="contains">contains</option>')
                                    .append('<option value="is">is exactly</option>').append('<option value="not">is not</option>')
                                    .val("contains");
                            } else {
                                alert("Error, could not determine the type of search");
                            }

                            jquery("#filterAttributeInput").on("change", setupFilterDropdowns);

                        });

                        // advanced search adding a filter
                        jquery(".btn-default[data-action='addFilter']").click(function(e) {

                            // just for debugging
                            var queryBody = jquery("#queryBody");

                            // Obtain the input values
                            var searchField = jquery("#filterAttributeInput").val();
                            var searchOperator = jquery("#filterOpInput").val();
                            var searchValue = jquery("#searchValue").val();
                            var searchType = jquery("#advancedSearchModal .advanced-search-type.active").attr("data-action");
                            var searchLocation = jquery("#advancedSearchModal .advanced-search-location.active").attr("data-action");

                            // Create a new filter and append
                            var filterTitle = "Filter by " + searchField;
                            var filterDescription = searchField + " " + searchOperator + " \"" + searchValue + "\"";

                            // Compose the filter definition based on the inputs
                            var filterdefinition = composeFilter(searchLocation, searchType, searchField, searchOperator, searchValue);
                            var filterTemplate = jquery("#filterContentTemplate").html();
                            var filterHtml = mustache.to_html(filterTemplate, {
                                filterTitle: filterTitle,
                                filterDescription: filterDescription,
                                filterattribute: searchField,
                                filteroperator: searchOperator,
                                filtervalue: searchValue,
                                filterdefinition: filterdefinition,
                                thumbnail: "thumbnailurl"
                            });

                            // If a filter on that attribute exists append to it. Otherwise create a new filter for that attribute
                            var existingMatchingFilters = jquery("#queryBody .filterDefinition[data-filterattribute='" + searchField + "']");
                            if (existingMatchingFilters.length > 0) {

                                // Create a conjunction filter if the search field is tags (multivalued)
                                var conjunctionHtml = null;
                                if (searchField === "Tag") {
                                   var conjunctionTemplate = jquery("#filterConjunctionTemplate").html();
                                   conjunctionHtml = mustache.to_html(conjunctionTemplate, {
                                       filterattribute: "operator",
                                       filterdefinition: "OR",
                                       operator: "+"
                                   });
                                }

                                var compoundFilter = jquery("#queryBody .filterDefinition[data-filterattribute='" + searchField + "']").filter("[data-filterdefinition='compound']");
                                if (compoundFilter.length > 0) { // If there is already a compound filter for the given attribute

                                    // If the filter was on tags then we add a conjunction term to toggle between AND/OR.
                                    if (conjunctionHtml) {
                                        compoundFilter.find(".panel-body").first().append(conjunctionHtml);
                                    }

                                     // Append the new filter into the body of the existing filter
                                    var newNode = compoundFilter.find(".panel-body").first().append(filterHtml);

                                    compoundFilter.find(".panel-body").last().removeClass("panel-info").addClass("panel-default");
                                    compoundFilter.find(".panel-body").last().find(".filterTitle").html(newNode.find(".panel-body").last().html());

                                } else {
                                    compoundFilter = mustache.to_html(jquery("#filterContentTemplate").html(), {
                                        filterTitle: filterTitle,
                                        filterDescription: "",
                                        filterattribute: searchField,
                                        filterdefinition: "compound",
                                        thumbnail: "thumbnailurl"
                                    });

                                    var previousFilter = existingMatchingFilters.replaceWith(compoundFilter);
                                    previousFilter.removeClass("panel-info").addClass("panel-default");

                                    previousFilter.find(".filterTitle").html(previousFilter.find(".panel-body").html());

                                    previousFilter.find(".panel-body").remove();
                                    
                                    var newRootCompoundFilter = jquery("#queryBody .filterDefinition[data-filterattribute='" + searchField + "']").filter("[data-filterdefinition='compound']");
                                    newRootCompoundFilter.find(".panel-body").append(previousFilter);
                                    var newFinishedFilter = newRootCompoundFilter.find(".panel-body").first().append(filterHtml);

                                    // If the filter was on tags then we add a conjunction term to toggle between AND/OR.
                                    if (conjunctionHtml) {
                                        previousFilter.after(conjunctionHtml);
                                    }

                                    newFinishedFilter.find(".panel").last().removeClass("panel-info").addClass("panel-default");
                                    newFinishedFilter.find(".filterTitle").last().html(newFinishedFilter.find(".panel-body").last().html());
                                    newFinishedFilter.find(".panel-body").last().remove();
                                }

                                // highlight animation for the newly updated filter
                                var filterPanel = existingMatchingFilters.find(".filterPanelHeading");
                                filterPanel.css("background-color", "#5cc864"); // alternate color to try: "#b4f09b"
                                setTimeout(function(){ filterPanel.css("background-color", ""); }, 1000);

                            } else {
                                // The relation between the filters is an implicit AND relation so just append here.
                                jquery("#queryBody").append(filterHtml);
                            }
                        });

                        jquery(".btn-primary[data-action='advancedSearch']").click(function(e) {
                            var filters = jquery("#queryBody .filterDefinition");
                            if (filters.length && filters.length > 0) {
                                // Debugging only
                                //console.debug("filter found!");
                            } else {
                                alert("Requires filter to search. Add a filter.");
                                e.preventDefault();
                                e.stopImmediatePropagation();
                                return false; 
                            }

                            searchAdvanced();
                        });

                        // Add handler for the delete filters
                        jquery("#queryBody").on("click", ".btn-default[data-deletefilter]", function(e) {
                            // Since nested is possible for multiple filters of the same attribute we
                            // use "first()" to only remove the one immediately above the target
                            jquery(e.target).parents(".filterDefinition").first().remove("[data-filterdefinition]");

                            // if there are no more filters then trim out the whitespace so that
                            // the css empty selector can display the no filters added message
                            if (jquery(".filterDefinition").length === 0) {
                                jquery("#queryBody").text("");
                            }
                        });

                        // add a handler to filter dropdown of operators available based on the
                        // attribute that is selected
                        jquery("#filterAttributeInput").on("change", setupFilterDropdowns);

                        // This section is removed due to changing relationships between filters
                        // to be an implicit "AND"
                        // add a handler to toggle conjuctions between AND and OR
                        jquery("#queryBody").on("click", ".btn.filter-conjuction", function(e) {
                            var nodeEl = jquery(e.target).children(".fa");
                            if(nodeEl.text() === "&nbsp;(And)" || nodeEl.text() === " (And)") {
                                // TODO: change data-filterdefinition of parent
                                nodeEl.removeClass("fa-plus");
                                nodeEl.addClass("fa-arrows-h");
                                nodeEl.text(" (Or)");
                                jquery(e.target).attr("data-filterdefinition", "OR");
                            } else {
                                // TODO: change data-filterdefinition of parent
                                nodeEl.removeClass("fa-arrows-h");
                                nodeEl.addClass("fa-plus");
                                nodeEl.text(" (And)");
                                jquery(e.target).attr("data-filterdefinition", "AND");
                            }

                            nodeEl.parents(".btn.filter-conjuction").css("background-color", "#5cc864"); // alternate color to try: "#b4f09b"
                            setTimeout(function(){ nodeEl.parents(".btn.filter-conjuction").css("background-color", ""); }, 500);
                        });
                }

                jquery("#advancedSearchModal").modal("show");

            } else if (selectedAction !== "viewMyContent") {
                jquery("#searchMenu li").removeClass("active");
                jquery(e.target).parent().addClass("active");
                if (jquery("#searchText").val()) {
                    // If a search term already exists, then perform the search.
                    search();
                } else {
                    // Change the placeholder.
                    jquery("#searchText").attr("placeholder",
                        jquery(e.currentTarget).text());
                }
            } else {
                NProgress.start();
                listUserItems();
                NProgress.done();
            }
        });

        jquery(document).on("click", "#btnSimpleCopy", function() {
            jquery("#serviceNameForm").hide();
            jquery(".alert-danger.alert-dismissable").remove();
            jquery("#btnCopyService").removeClass("disabled");
            jquery("#btnSimpleCopy").addClass("btn-primary active");
            jquery("#btnFullCopy").removeClass("btn-primary active");
            jquery("#btnFullCopy").addClass("btn-default");
        });

        jquery(document).on("click", "#btnFullCopy", function() {
            jquery("#serviceNameForm").show();
            jquery("#btnCopyService").addClass("disabled");
            jquery("#btnFullCopy").addClass("btn-primary active");
            jquery("#btnSimpleCopy").removeClass("btn-primary active");
            jquery("#btnSimpleCopy").addClass("btn-default");
            jquery("#serviceName").blur();
        });

        jquery(document).on("click", ".moreInfo", function() {
            var element = jquery(this);

            var rootEl = element.parents(".btn.btn-block.content");
            console.debug("rootEl:", rootEl);
            var id = rootEl.attr("data-id");
            var dataType = rootEl.attr("data-type");

            console.debug("id:", id);
            console.debug("data-type:", dataType);
            if (dataType === "User") {
                window.open(app.portals.sourcePortal.portalUrl + "home/user.html?user=" + id, "_blank");
            } else {
                window.open(app.portals.sourcePortal.portalUrl + "home/item.html?id=" + id, "_blank");
            }
        });

        // Add a listener for the future cancel copy button.
        jquery(document).on("click", "#btnCancelCopy", function(e) {
            var id = jquery(e.currentTarget).attr("data-id");
            jquery(".clone[data-id='" + id + "']").remove();
            jquery("#btnCancelCopy").attr("data-id", "");
            jquery("#serviceName").attr("value", "");
            jquery("#btnSimpleCopy").click(); // Reset everything.
            jquery("#deepCopyModal").modal("hide");
        });

        // Add a listener for the future copy button.
        jquery(document).on("click", "#btnCopyService", function(e) {
            var id = jquery(e.currentTarget).attr("data-id");
            var folder = jquery(".clone[data-id='" + id + "']").parent().attr("data-folder");
            var copyType = jquery("#copySelector > .btn-primary").text();
            switch (copyType) {
            case "Simple":
                simpleCopy(id, folder);
                break;
            case "Full":
                deepCopyFeatureService(id, folder);
                break;
            }
            jquery("#btnCancelCopy").attr("data-id", "");
            jquery("#serviceName").attr("value", "");
            jquery("#btnSimpleCopy").click(); // Reset everything.
            jquery("#deepCopyModal").modal("hide");
        });

        // Add a listener for the copy warning button.
        jquery(document).on("click", "#btnBulkCopyServices", function(e) {
            var bulkCopyBtn = jquery("#btnBulkCopyServices");
            var items = bulkCopyBtn.data("data-items");
            var destination = bulkCopyBtn.data("data-destination");

            bulkCopyBtn.data("data-items", "");
            bulkCopyBtn.data("data-destination", "");

            jquery("#bulkCopyWarningModal").modal("hide");
            completeMoveItems(items, destination);
        });

        jquery(document).on("click", "li [data-action]", function(e) {
            // Highlight the selected action except for "View My Stats."
            var selectedAction = jquery(e.target).parent().attr("data-action");
            if (selectedAction !== "stats") {
                jquery("#actionDropdown li").removeClass("active");
                jquery(e.target).parent().addClass("active");
            }

            // Hide tooltips
            jquery(".hideToolTipOption").css("visibility", "hidden");

            // If in multiple selection mode, add the multiple mode items
            if (isMultipleSelectionMode()) {
                jquery(".multiplemode").css("display", "");
            } else {
                jquery(".multiplemode").css("display", "none");
            }

            if (selectedAction === "bulkCopyContent" || selectedAction === "copyContent") {
                jquery(".hideToolTipOption").css("visibility", "visible");
            }

            // Choose what to do based on the selection.
            switch (selectedAction) {
                case "inspectContent":
                    // Enable inspecting of content.
                    cleanUp();
                    inspectContent();
                    break;
                case "updateWebmapServices":
                    cleanUp();
                    updateWebmapServices();
                    break;
                case "addRemoveContentTags":
                    cleanUp();
                    highlightUpdateTagsContent();
                    break;
                case "updateProtection":
                    cleanUp();
                    highlightUpdateProtectionContent();
                    break;
                case "deleteContent":
                    cleanUp();
                    highlightDeleteContent();
                    break;
                case "updateContentUrl":
                    cleanUp();
                    updateContentUrls();
                    break;
                case "exportSearchResultsToCSV":
                    cleanUp();
                    highlightExportSearchResultsToCSV();
                    break;
                case "bulkReassignOwnership":
                    cleanUp();
                    highlightReassignOwnershipContent();
                    break;
                case "testRegisteredServices":
                    cleanUp();
                    testRegisteredServices();
                    break;
                case "stats":
                    viewStats();
                    break;
                case "logout":
                    logout();
                    break;
            }
        });

        // Clean up the lists when copy content is selected.
        jquery("#copyModal").on("show.bs.modal", function() {
            cleanUp();
            jquery("#destinationChoice").css("display", "block");
            jquery("#destinationForm").css("display", "none");
        });

    });

});
