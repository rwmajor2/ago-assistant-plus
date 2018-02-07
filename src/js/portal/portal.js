define(["jquery", "portal/util"], function(jquery, util) {
    return {
        Portal: function(config) {
            config = typeof config !== "undefined" ? config : {};
            this.portalUrl = config.portalUrl;
            this.username = config.username;
            this.token = config.token;
            this.withCredentials = false;
            this.jsonp = false;
            this.items = [];
            this.services = [];
            /**
             * Return the version of the portal.
             */
            this.version = function() {
                if (this.jsonp) {
                    return jquery.ajax({
                        type: "GET",
                        url: this.portalUrl + "sharing/rest?f=json",
                        async: false,
                        jsonpCallback: "callback",
                        crossdomain: true,
                        contentType: "application/json",
                        dataType: "jsonp"
                    });
                } else {
                    return jquery.ajax({
                        type: "GET",
                        url: this.portalUrl + "sharing/rest?f=json",
                        dataType: "json",
                        xhrFields: {
                            withCredentials: this.withCredentials
                        }
                    });
                }
            };
            /**
             * Return the view of the portal as seen by the current user,
             * anonymous or logged in.
             */
            this.self = function() {
                return jquery.ajax({
                    type: "GET",
                    url: this.portalUrl + "sharing/rest/portals/self?" + jquery.param({
                        token: this.token,
                        f: "json"
                    }),
                    dataType: "json",
                    xhrFields: {
                        withCredentials: this.withCredentials
                    }
                });
            };
            /**
             * Generates an access token in exchange for user credentials that
             * can be used by clients when working with the ArcGIS Portal API.
             */
            this.generateToken = function(username, password) {

                // If the referer ends with a # symbol (added by clicking menu items)
                // remove it to prevent errors when obtaining a token for the wrong referer.
                var referer = jquery(location).attr("href");
                if (referer.endsWith("#")) {
                    referer = referer.substring(0, referer.length - 1);
                }

                return jquery.ajax({
                    type: "POST",
                    url: this.portalUrl + "sharing/rest/generateToken?",
                    data: {
                        username: username,
                        password: password,
                        referer: referer, // URL of the sending app.
                        expiration: 60, // Lifetime of the token in minutes.
                        f: "json"
                    },
                    dataType: "json",
                    xhrFields: {
                        withCredentials: this.withCredentials
                    }
                });
            };
            /**
             * Searches for content items in the portal.
             * The results of a search only contain items that the user
             * (token) has permission to access.
             * Excluding a token will yield only public items.
             */
            this.search = function(query, numResults, sortField, sortOrder, start/*Optional*/) {
                return jquery.ajax({
                    type: "GET",
                    url: this.portalUrl + "sharing/rest/search?",
                    data: {
                        q: query,
                        num: numResults,
                        start: start,
                        sortField: sortField,
                        sortOrder: sortOrder,
                        token: this.token,
                        f: "json"
                    },
                    dataType: "json",
                    xhrFields: {
                        withCredentials: this.withCredentials
                    }
                });
            };
            /**
             * Searches for content items in the portal.
             * Returns the aggregate of the search across all pages for searches
             * that return more than the 100 result limit. NOTE: the results are
             * not currently ordered and may return in different orders based
             * on how fast the responses are returned. A future nhancement can be
             * made to preserve order.
             */
            this.pagingSearch = function(query, sortField, sortOrder, limit) {

                // Basically a toArray() conversion
                var efficient = function(obj, offset, startWith){
                    return (startWith||[]).concat(Array.prototype.slice.call(obj, offset||0));
                };

                // Equivalent of a dojo lang.hitch
                var partial = function(method){
                    console.debug("partial getting called with arguments:", arguments);
                    var arr = [];
                    var secondArg = arr.concat(efficient(arguments));
                    secondArg.splice(1, 0, jquery); // inject the context inbetween the method to call and the params
                    return jquery.proxy.apply(jquery, secondArg); // Function
                };

                // Defer results until all paged searches complete.
                var df = new jquery.Deferred();
                var finalResults = {};
                var _this = this;
                var initialLimit = limit > 0 && limit < 100 ? limit : 100; // Where the limit is set less than the first 100 items

                this.search(query, initialLimit, sortField, sortOrder, 0).done(function(response) {
                    finalResults = response;
                    console.debug("first call results:", finalResults);

                    if (finalResults.total > 100 && (!limit || limit > 100)) {
                        console.debug("finalResults.total: " + finalResults.total);
                        var totalToRequest = limit > 0 && limit < finalResults.total ? limit : finalResults.total;

                        var numRemainReq = Math.floor((totalToRequest - 100) / 100);
                        console.debug("intermediate numRemainReq: ", numRemainReq);
                        if ((totalToRequest - 100) % 100 > 0) {
                            console.debug("adding on one more request");
                            numRemainReq = numRemainReq + 1;
                        }

                        var remainder = (totalToRequest - 100) % 100;
                        console.debug("remainder is :" + remainder);

                        console.debug("numRemainReq: ", numRemainReq);

                        var cb = function(firstparam, innerResponse, thirdParam, fourthParam) {
                            console.debug("cb arguments:", arguments);
                            finalResults.results.push.apply(finalResults.results, innerResponse.results);
                            finalResults.num = finalResults.num + innerResponse.num;
                            if (innerResponse.nextStart > finalResults.nextStart) {
                                finalResults.nextStart = innerResponse.nextStart;
                            }

                            firstparam.resolve();
                        };

                        // Set up the total number of requests
                        var pagedRequests = [];
                        for (var i = 0; i < numRemainReq; i++) {
                            console.debug("Adding additional request for features starting at: ", ((100 * (i+1)) + 1));
                            var deferredPart = new jquery.Deferred();
                            deferredPart.counterBlah = i;
                            pagedRequests.push(deferredPart);

                            var numToRequest = i === (numRemainReq - 1) && remainder > 0 ? remainder : 100;
                            console.debug("per request numToRequest:", numToRequest);

                            _this.search(query, numToRequest, sortField, sortOrder,  ((100 * (i+1)) + 1)).done(partial(cb, deferredPart));

                            // necessary to batch them later for more requests. for now, just fire all of them off
/*
                            pagedRequests.push(jquery.Deferred());
                            // Set up batches of 5 or less
                            var pagingBatch = [];
                            jquery.when.apply(jquery, pagingBatch).then(function(results) {
                                deferred.resolve(results);
                            }, function(error) {
                                deferred.resolve(error);
                            });

                            // If it is a batch of 5 or if it is the last of the total pages
                            if ((i % 5 === 0 && i > 0) || i === (numRemaining - 1)) {

                            }*/

                        }

                        // Defer providing the results until all pages come back.
                        jquery.when.apply(jquery, pagedRequests).then(function(results) {

                            console.debug("The completed set of results to check for values:", finalResults);

                            df.resolve(finalResults);
                        }, function(error) {
                            console.error("Error: ", error);
                            df.resolve(error);
                        });
                    } else {
                         df.resolve(finalResults);
                    }
                });

                return df;
            };

            this.testServiceStatuses = function(urlTests) {
                 console.debug("Testing services here.");

                // Basically a toArray() conversion
                var efficient = function(obj, offset, startWith){
                    return (startWith||[]).concat(Array.prototype.slice.call(obj, offset||0));
                };

                // Equivalent of a dojo lang.hitch
                var partial = function(method){
                    console.debug("partial getting called with arguments:", arguments);
                    var arr = [];
                    var secondArg = arr.concat(efficient(arguments));
                    secondArg.splice(1, 0, jquery); // inject the context inbetween the method to call and the params
                    return jquery.proxy.apply(jquery, secondArg); // Function
                };

                 var df = new jquery.Deferred();

                var cb = function(firstparam, innerResponse, thirdParam, fourthParam) {
                            console.debug("callback arguments received:", arguments);

                            //console.debug("appending inner results to the final results: ", innerResponse.results);
                            //finalResults.results.push.apply(finalResults.results, innerResponse.results);
                            console.debug("testing thirdParam that will be the item for the service that gets recorded for success or failure: ", innerResponse);
                            if (fourthParam === "error") {
                                errorServices.push(innerResponse);
                            } else if (fourthParam === "success") {
                                successServices.push(innerResponse);
                            } else if (fourthParam === "parsererror") {
                                console.debug("parse error case");
                                errorServices.push(innerResponse);
                            } else {
                                console.debug("unknown status: " + fourthParam + " for service: ", innerResponse);
                            }
                            firstparam.resolve();
                };

                // unused?
                var cb2 = function(data, textStatus, errorThrown) {
                            console.debug("data: ", data);
                            console.debug("textStatus: ", textStatus);
                            console.debug("errorThrown: ", errorThrown);
                            if (textStatus === "error") {
                                errorServices.push();
                            }
                };

                var errorServices = [];
                var successServices = [];
                var urlTestDefers = [];
                for (var i = 0; i < urlTests.length; i++) {
                    var urlTestItem = urlTests[i];
                    console.debug("adding a urlTest for item: ", urlTestItem);
                    var testDf = new jquery.Deferred();
                    testDf.blahCounterTest = i;
                    urlTestDefers.push(testDf);

                    // run the test
                    jquery.ajax({
                        type: "GET",
                        url: urlTestItem.url,
                        data: {
                            f: "json"
                        },
                        dataType: "json",
                        xhrFields: {
                            withCredentials: this.withCredentials
                        }
                    }).always(partial(cb, testDf, urlTestItem));
                }

                jquery.when.apply(jquery, urlTestDefers).then(function(results) {
                    console.debug("final WHEN running for completion of callbacks");
                    df.resolve({"successServices": successServices, "errorServices": errorServices});
                }, function(error) {
                    console.error("Error: ", error);
                    df.resolve(error);
                });

                 return df;
            };
            /**
             * Searches for users in the portal.
             * The results of a search only contain users that the user
             * (token) has permission to access.
             * Excluding a token will yield only public items.
             */
            this.searchUsers = function(query, numResults, sortField, sortOrder) {
                return jquery.ajax({
                    type: "GET",
                    url: this.portalUrl + "sharing/rest/community/users?",
                    data: {
                        q: query,
                        num: numResults,
                        sortField: sortField,
                        sortOrder: sortOrder,
                        token: this.token,
                        f: "json"
                    },
                    dataType: "json",
                    xhrFields: {
                        withCredentials: this.withCredentials
                    }
                });
            };
            /**
             * Searches for groups in the portal.
             * The results of a search only contain groups that the user
             * (token) has permission to access.
             * Excluding a token will yield only public items.
             */
            this.searchGroups = function(query, numResults, sortField, sortOrder) {
                return jquery.ajax({
                    type: "GET",
                    url: this.portalUrl + "sharing/rest/community/groups?",
                    data: {
                        q: query,
                        num: numResults,
                        sortField: sortField,
                        sortOrder: sortOrder,
                        token: this.token,
                        f: "json"
                    },
                    dataType: "json",
                    xhrFields: {
                        withCredentials: this.withCredentials
                    }
                });
            };
            /**
             * Retrieves the info for a group in the portal specified
             * by the supplied group id.
             */
            this.groupInfo = function(groupId) {
                return jquery.ajax({
                    type: "GET",
                    url: this.portalUrl + "sharing/rest/community/groups/" + groupId + "?",
                    data: {
                        token: this.token,
                        f: "json"
                    },
                    dataType: "json",
                    xhrFields: {
                        withCredentials: this.withCredentials
                    }
                });
            };
            /**
             * Retrieves the user profile for the user specified by
             * the supplied username.
             */
            this.userProfile = function(username) {
                return jquery.ajax({
                    type: "GET",
                    url: this.portalUrl + "sharing/rest/community/users/" + username + "?",
                    data: {
                        token: this.token,
                        f: "json"
                    },
                    dataType: "json",
                    xhrFields: {
                        withCredentials: this.withCredentials
                    }
                });
            };
            /**
             * Retrieves the tags for the user specified by the supplied username.
             */
            this.userTags = function(username) {
                return jquery.ajax({
                    type: "GET",
                    url: this.portalUrl + "sharing/rest/community/users/" + username + "/tags?",
                    data: {
                        token: this.token,
                        f: "json"
                    },
                    dataType: "json",
                    xhrFields: {
                        withCredentials: this.withCredentials
                    }
                });
            };
            /**
             * Return the portal users viewable by the current user,
             * anonymous or logged in.
             */
            this.portalUsers = function() {
                return jquery.ajax({
                    type: "GET",
                    url: this.portalUrl + "sharing/rest/portals/self/users?",
                    data: {
                        start: 1,
                        num: 100,
                        sortField: "username",
                        sortOrder: "asc",
                        token: this.token,
                        f: "json"
                    },
                    dataType: "json",
                    xhrFields: {
                        withCredentials: this.withCredentials
                    }
                });
            };
            /**
             * Retrieves the user's content based on the the supplied
             * username and folder location (may be "/").
             */
            this.userContent = function(username, folder) {
                return jquery.ajax({
                    type: "GET",
                    url: this.portalUrl + "sharing/rest/content/users/" + username + "/" + folder + "?",
                    data: {
                        token: this.token,
                        f: "json"
                    },
                    dataType: "json",
                    xhrFields: {
                        withCredentials: this.withCredentials
                    }
                });
            };
            /**
             * Obtains the full description for the item specified by the 
             * supplied item id. This method handles a single id or an 
             * array id. TODO: Convert this to separate function and restore the previous single one.
             */
            this.itemDescriptions = function(id) {
                if (jquery.isArray(id)) {
                    var itemInfoRequests = [];
                    var scopeFunction = jquery.proxy(function(idParam) {
                        itemInfoRequests.push(this.itemDescription(idParam));
                    }, this);

                    var self = this; // to scope the itemDescription inside the loop
                    jquery.each(id, function( index, value ) {
                        var id = value;
                        scopeFunction(id); // Use this scope function instead of the below. Currently there is a bug with the below saved value.
                        //itemInfoRequests.push(jquery.proxy(self.itemDescription(id), self));
                    });

                    return jquery.when.apply(jquery, itemInfoRequests).then(function(results) {
                        if(arguments.length > 0) {
                            if (jquery.isArray(arguments[0]) && arguments[0].length && arguments[0][1] === "success") {
                                console.debug("An array of results was returned to handle multiple items");
                            }
                        }

                        return arguments;
                    }, function(error) {
                        console.error("Error function triggered.", error);
                    });

                } else {
                    return this.itemDescription(id);
                }
            };

            this.itemDescription = function(id) {
                return jquery.ajax({
                    type: "GET",
                    url: this.portalUrl + "sharing/rest/content/items/" + id + "?",
                    data: {
                        token: this.token,
                        f: "json"
                    },
                    dataType: "json",
                    xhrFields: {
                        withCredentials: this.withCredentials
                    }
                });
            };
            /**
             * Retrieves the full data for the item specified by the supplied item id.
             */
            this.itemData = function(id) {
                return jquery.ajax({
                    type: "GET",
                    url: this.portalUrl + "sharing/rest/content/items/" + id + "/data?",
                    data: {
                        token: this.token,
                        f: "json"
                    },
                    dataType: "json",
                    xhrFields: {
                        withCredentials: this.withCredentials
                    }
                });
            };
            /**
             * Create a new item on the specified portal.
             */
            this.addItem = function(username, folder, description, data, thumbnailUrl) {
                // Clean up description items for posting.
                // This is necessary because some of the item descriptions (e.g. tags and extent)
                // are returned as arrays, but the post operation expects comma separated strings.
                jquery.each(description, function(item, value) {
                    if (value === null) {
                        description[item] = "";
                    } else if (value instanceof Array) {
                        description[item] = util.arrayToString(value);
                    }
                });

                // Create a new item in a user's content.
                var params = {
                    item: description.title,
                    text: JSON.stringify(data), // Stringify the Javascript object so it can be properly sent.
                    overwrite: false, // Prevent users from accidentally overwriting items with the same name.
                    thumbnailurl: thumbnailUrl,
                    f: "json",
                    token: this.token
                };
                return jquery.ajax({
                    type: "POST",
                    url: this.portalUrl + "sharing/rest/content/users/" + username + "/" + folder + "/addItem?",
                    data: jquery.extend(description, params), // Merge the description and params JSON objects.
                    dataType: "json",
                    xhrFields: {
                        withCredentials: this.withCredentials
                    }
                });
            };
            /**
             * Delete an item from the portal specified by the username and
             * item id string. This method requires more testing as it invokes the 
             * deleteItems method that has been tested, but it hasn't been tested separately.
             */
            this.deleteItem = function(username, deleteItem) {
                return this.deleteItems(username, [deleteItem]);
            };
            /**
             * Delete items from the portal specified by the supplied username
             * and the string array of item ids.
             */
            this.deleteItems = function(username, deleteItems) {

                // Delete a single or multiple items at once per user.
                var params = {
                    items: deleteItems.join(","),
                    f: "json",
                    token: this.token
                };
                return jquery.ajax({
                    type: "POST",
                    url: this.portalUrl + "sharing/rest/content/users/" + username + "/deleteItems",
                    data: params,
                    dataType: "json",
                    xhrFields: {
                        withCredentials: this.withCredentials
                    }
                });
            };
            /**
             * Re-assigns ownership of items from a specified portal user to another user.
             * If the target owner folder does not exist it will be created automatically.
             */
            this.reassignItem = function(username, id, folder, targetOwnerUsername, targetOwnerFolderName) {
                return jquery.ajax({
                    type: "POST",
                    url: this.portalUrl + "sharing/rest/content/users/" + username + "/" + folder + "/items/" + id + "/reassign",
                    data: {
                        "targetUsername": targetOwnerUsername,
                        "targetFolderName": targetOwnerFolderName,
                        token: this.token,
                        f: "json"
                    },
                    dataType: "json",
                    xhrFields: {
                        withCredentials: this.withCredentials
                    }
                });
            };
            /**
             * Re-assigns ownership of a group from one portal user to another. The previous
             * owner will remain a member of the group unless specifically removed
             * in a separate portal operation.
             */
            this.reassignGroup = function(id, targetOwnerUsername) {
                return jquery.ajax({
                    type: "POST",
                    url: this.portalUrl + "sharing/rest/community/groups/" + id + "/reassign",
                    data: {
                        "targetUsername": targetOwnerUsername,
                        token: this.token,
                        f: "json"
                    },
                    dataType: "json",
                    xhrFields: {
                        withCredentials: this.withCredentials
                    }
                });
            };
            /**
             * Update the content in a web map.
             */
            this.updateWebmapData = function(username, folder, id, data) {
                return jquery.ajax({
                    type: "POST",
                    url: this.portalUrl + "sharing/rest/content/users/" + username + "/" + folder + "/items/" + id + "/update?",
                    data: {
                        text: JSON.stringify(data), // Stringify the Javascript object so it can be properly sent.
                        token: this.token,
                        f: "json"
                    },
                    dataType: "json",
                    xhrFields: {
                        withCredentials: this.withCredentials
                    }
                });
            };
            /**
             * Update the description for an item or multiple items. This method needs to be
             * split into a separate updateDescriptions method.
             */
            this.updateDescription = function(usernameOrUpdateArray, id, folder, description) {

                // convert input to an input array
                var updateRequestInfo = usernameOrUpdateArray;
                if (!jquery.isArray(usernameOrUpdateArray)) {
                    updateRequestInfo = [{
                           username: usernameOrUpdateArray,
                           id: id,
                           folder: folder,
                           description: description
                    }];
                }

                var itemUpdateRequests = [];
                var portalUrl = this.portalUrl;
                var token = this.token;
                var withCredentials = this.withCredentials;
                jquery.each(updateRequestInfo, function( index, value ) {
                        var postData = JSON.parse(value.description);
                        /**
                         * Clean up description items for posting.
                         * This is necessary because some of the item descriptions
                         * (e.g. tags and extent) are returned as arrays, but the post
                         * operation expects comma separated strings.
                         */
                        jquery.each(postData, function(postItem, postValue) {
                            if (postValue === null) {
                                postData[postItem] = "";
                            } else if (postValue instanceof Array) {
                                postData[postItem] = postValue.join(",");
                            }
                        });

                        postData.token = token;
                        postData.f = "json";
                        itemUpdateRequests.push(jquery.ajax({
                            type: "POST",
                            url: portalUrl + "sharing/rest/content/users/" + value.username + "/" + value.folder + "/items/" + value.id + "/update",
                            data: postData,
                            dataType: "json",
                            xhrFields: {
                                withCredentials: withCredentials
                            }
                        }));
                });

                //return jquery.when.apply(jquery, itemInfoRequests);
                return jquery.when.apply(jquery, itemUpdateRequests).then(function(results) {
                    console.debug("results in portal.js:", results);
                    console.debug("arguments::::", arguments);
                    if(arguments.length > 0) {
                        if (jquery.isArray(arguments[0]) && arguments[0].length && arguments[0][1] === "success") {
                            console.debug("An array of results was returned to handle multiple items");
                        }
                    }

                    if (arguments[1] === "success") {
                        return [arguments];
                    }
                    return arguments;
                });
            };

            /**
             * Update the description for an item or multiple items. This method needs to be
             * split into a separate updateDescriptions method.
             */
            this.protectItem = function(usernameOrUpdateArray, id, folder) {

                // convert input to an input array
                var updateProtectionInfo = usernameOrUpdateArray;
                if (!jquery.isArray(usernameOrUpdateArray)) {
                    updateProtectionInfo = [{
                           username: usernameOrUpdateArray,
                           id: id,
                           folder: folder
                    }];
                }

                var itemProtectRequests = [];
                var portalUrl = this.portalUrl;
                var token = this.token;
                var withCredentials = this.withCredentials;
                jquery.each(updateProtectionInfo, function( index, value ) {
                        var postData = {};
                        postData.token = token;
                        postData.f = "json";
                        itemProtectRequests.push(jquery.ajax({
                            type: "POST",
                            url: portalUrl + "sharing/rest/content/users/" + value.username + "/" + value.folder + "/items/" + value.id + "/protect",
                            data: postData,
                            dataType: "json",
                            xhrFields: {
                                withCredentials: withCredentials
                            }
                        }));
                });

                //return jquery.when.apply(jquery, itemInfoRequests);
                return jquery.when.apply(jquery, itemProtectRequests).then(function(results) {
                    if(arguments.length > 0) {
                        if (jquery.isArray(arguments[0]) && arguments[0].length && arguments[0][1] === "success") {
                            console.debug("An array of results was returned to handle multiple items");
                        }
                    }
                    return arguments;
                });
            };

                        /**
             * Update the description for an item or multiple items. This method needs to be
             * split into a separate updateDescriptions method.
             */
            this.unprotectItem = function(usernameOrUpdateArray, id, folder) {

                // convert input to an input array
                var updateProtectionInfo = usernameOrUpdateArray;
                if (!jquery.isArray(usernameOrUpdateArray)) {
                    updateProtectionInfo = [{
                           username: usernameOrUpdateArray,
                           id: id,
                           folder: folder
                    }];
                }

                var itemProtectRequests = [];
                var portalUrl = this.portalUrl;
                var token = this.token;
                var withCredentials = this.withCredentials;
                jquery.each(updateProtectionInfo, function( index, value ) {
                        var postData = {};
                        postData.token = token;
                        postData.f = "json";
                        itemProtectRequests.push(jquery.ajax({
                            type: "POST",
                            url: portalUrl + "sharing/rest/content/users/" + value.username + "/" + value.folder + "/items/" + value.id + "/unprotect",
                            data: postData,
                            dataType: "json",
                            xhrFields: {
                                withCredentials: withCredentials
                            }
                        }));
                });

                //return jquery.when.apply(jquery, itemInfoRequests);
                return jquery.when.apply(jquery, itemProtectRequests).then(function(results) {
                    if(arguments.length > 0) {
                        if (jquery.isArray(arguments[0]) && arguments[0].length && arguments[0][1] === "success") {
                            console.debug("An array of results was returned to handle multiple items");
                        }
                    }
                    return arguments;
                });
            };

            /**
             * How does this method differ from the updateDescription method?
             */
            this.updateData = function(username, id, folder, data) {
                // Update the content in a web map.
                return jquery.ajax({
                    type: "POST",
                    url: this.portalUrl + "sharing/rest/content/users/" + username + "/" + folder + "/items/" + id + "/update",
                    data: {
                        text: data, // Stringify the Javascript object so it can be properly sent.
                        token: this.token,
                        f: "json"
                    },
                    dataType: "json",
                    xhrFields: {
                        withCredentials: this.withCredentials
                    }
                });
            };
            /**
             * Update the URL of a registered service or web application.
             */
            this.updateUrl = function(username, folder, id, url) {
                return jquery.ajax({
                    type: "POST",
                    url: this.portalUrl + "sharing/rest/content/users/" + username + "/" + folder + "/items/" + id + "/update",
                    data: {
                        url: url,
                        token: this.token,
                        f: "json"
                    },
                    dataType: "json",
                    xhrFields: {
                        withCredentials: this.withCredentials
                    }
                });
            };
            /**
             * Get service details.
             */
            this.serviceDescription = function(url) {
                return jquery.ajax({
                    type: "GET",
                    url: url + "?" + jquery.param({
                        token: this.token,
                        f: "json"
                    }),
                    dataType: "json",
                    xhrFields: {
                        withCredentials: this.withCredentials
                    }
                });
            };
            /**
             * Get service layer details.
             */
            this.serviceLayers = function(url) {
                return jquery.ajax({
                    type: "GET",
                    url: url + "/layers?" + jquery.param({
                        token: this.token,
                        f: "json"
                    }),
                    dataType: "json",
                    xhrFields: {
                        withCredentials: this.withCredentials
                    }
                });
            };
            /**
             * Creates a service for the specified user and folder.
             */
            this.createService = function(username, folder, serviceParameters) {
                return jquery.ajax({
                    type: "POST",
                    url: this.portalUrl + "sharing/rest/content/users/" + username + "/" + folder + "/createService",
                    data: {
                        createParameters: serviceParameters,
                        outputType: "featureService",
                        token: this.token,
                        f: "json"
                    },
                    dataType: "json",
                    xhrFields: {
                        withCredentials: this.withCredentials
                    }
                });
            };
            /**
             * Adds a definition to the service for the specified service url.
             */
            this.addToServiceDefinition = function(serviceUrl, definition) {
                serviceUrl = serviceUrl.replace("/rest/services/", "/rest/admin/services/");
                return jquery.ajax({
                    type: "POST",
                    url: serviceUrl + "/addToDefinition",
                    data: {
                        addToDefinition: definition,
                        token: this.token,
                        f: "json"
                    },
                    dataType: "json",
                    xhrFields: {
                        withCredentials: this.withCredentials
                    }
                });
            };
            /**
             * Checks whether the specified service name is available.
             */
            this.checkServiceName = function(portalId, name, type) {
                return jquery.ajax({
                    type: "GET",
                    url: this.portalUrl + "sharing/rest/portals/" + portalId + "/isServiceNameAvailable?" + jquery.param({
                        name: name,
                        type: type,
                        token: this.token,
                        f: "json"
                    }),
                    dataType: "json",
                    xhrFields: {
                        withCredentials: this.withCredentials
                    }
                });
            };
            /**
             * Retrieves the record count of the layer specified by the
             * service url and layer id.
             */
            this.layerRecordCount = function(serviceUrl, layerId) {
                return jquery.ajax({
                    type: "GET",
                    url: serviceUrl + "/" + layerId + "/query?" + jquery.param({
                        where: "1=1",
                        returnCountOnly: true,
                        token: this.token,
                        f: "json"
                    }),
                    dataType: "json",
                    xhrFields: {
                        withCredentials: this.withCredentials
                    }
                });
            };
            /**
             * Retrieves records from the service specified by the service
             * url and layer id. The retrieval is done via a query operation
             * and the records retrieved will be offset by the offset parameter.
             */
            this.harvestRecords = function(serviceUrl, layerId, offset) {
                return jquery.ajax({
                    type: "GET",
                    url: serviceUrl + "/" + layerId + "/query?" + jquery.param({
                        where: "1=1",
                        outFields: "*",
                        returnGeometry: true,
                        resultOffset: offset,
                        resultRecordCount: 1000,
                        token: this.token,
                        f: "json"
                    }),
                    dataType: "json",
                    xhrFields: {
                        withCredentials: this.withCredentials
                    }
                });
            };
            /**
             * Adds records to the service specified by the service
             * url and layer id.
             */
            this.addFeatures = function(serviceUrl, layerId, features) {
                return jquery.ajax({
                    type: "POST",
                    url: serviceUrl + "/" + layerId + "/addFeatures",
                    data: {
                        features: features,
                        token: this.token,
                        f: "json"
                    },
                    dataType: "json",
                    xhrFields: {
                        withCredentials: this.withCredentials
                    }
                });
            };
            /**
             * cacheItem() Stores an item with the portal object.
             * @description {Object} the item's description object
             */
            this.cacheItem = function(description) {
                this.items.push({
                    id: description.id,
                    description: description
                });
            };
        }
    };
});
