/*
Thunderbird Filelink add-on for BSCW

Copyright 2020 Marius Shekow, Fraunhofer FIT

This file is part of https://github.com/FraunhoferFIT/thunderbird-bscw-filelink/

thunderbird-bscw-filelink is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

thunderbird-bscw-filelink is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with thunderbird-bscw-filelink. If not, see <https://www.gnu.org/licenses/>.
 */

var {ExtensionCommon} = ChromeUtils.import("resource://gre/modules/ExtensionCommon.jsm");
var {ExtensionUtils} = ChromeUtils.import("resource://gre/modules/ExtensionUtils.jsm");
var {Services} = ChromeUtils.import("resource://gre/modules/Services.jsm");
var {LoginManagerPrompter} = ChromeUtils.import("resource://gre/modules/LoginManagerPrompter.jsm");

var bundle = Services.strings.createBundle("chrome://global/locale/commonDialogs.properties");

var myLoginManager = class extends ExtensionCommon.ExtensionAPI {
    getAPI(context) {
        return {
            myLoginManager: {
                /**
                 * Returns either the cached username/password using Thunderbird's LoginManager
                 * (see https://developer.mozilla.org/en-US/docs/Mozilla/Tech/XPCOM/Reference/Interface/nsILoginManager/Using_nsILoginManager)
                 * or shows a prompt that asks the user to provide credentials.
                 * @param {string} url: the URL for which to get the login
                 * @param {boolean} discardCachedCredentials: if true, already stored logins are deleted, to force a new dialog prompt
                 * @returns {Promise<{username: (string), password: (string)}>}
                 */
                async getAndStoreUsernameAndPassword(url, discardCachedCredentials) {
                    let {displayHostPort, prePath, filePath} = Services.io.newURI(url);

                    if (discardCachedCredentials) {
                        let logins = Services.logins.findLogins(prePath, null, prePath);
                        for (let login of logins) {
                            Services.logins.removeLogin(login);
                        }
                    }
                    let logins = Services.logins.findLogins(prePath, null, prePath);
                    for (let login of logins) {
                        // Simply return the first login we found, if there is any, otherwise continue with the
                        // code below
                        return {username: login.username, password: login.password};
                    }

                    // Get data from user and store it
                    let title = bundle.GetStringFromName("PromptUsernameAndPassword2");
                    let text = bundle.formatStringFromName("EnterUserPasswordFor2", [displayHostPort], 1);
                    let usernameInput = {};
                    let passwordInput = {};
                    let prompter = new LoginManagerPrompter();
                    prompter.init(Services.ww.activeWindow);
                    // See https://developer.mozilla.org/en-US/docs/Mozilla/Tech/XPCOM/Reference/Interface/nsIAuthPrompt
                    if (!prompter.promptUsernameAndPassword(
                        title, text, prePath, Ci.nsIAuthPrompt.SAVE_PASSWORD_PERMANENTLY, usernameInput, passwordInput
                    )) {
                        throw new ExtensionUtils.ExtensionError("Authorization prompt cancelled");
                    }

                    return {username: usernameInput.value, password: passwordInput.value};
                },
            },
        };
    }
};
