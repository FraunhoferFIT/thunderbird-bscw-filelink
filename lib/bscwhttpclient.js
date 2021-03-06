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

MSGTYPE_INVOKE_LOGIN_MANAGER = "invokeLoginManager";
MSGTYPE_INVOKE_PASSWORD_POPUP = "invokePasswordPopup";
MSGTYPE_PASSWORD_POPUP_RESPONSE = "passwordPopupResponse";

/**
 * Raised by fetch() when an AbortController's abort() method was called.
 */
class UploadAbortedError extends Error {
}

/**
 * Thrown when the user aborted the dialog prompts that ask her for the credentials.
 */
class NoValidCredentialsProvidedError extends Error {
}

/**
 * Thrown when the user entered invalid credentials (as confirmed by the server).
 */
class CredentialsInvalidError extends Error {
}

/**
 * Thrown when checking the baseURL yields a HTTP 404 status code.
 */
class InvalidFolderError extends Error {
}

/**
 * Thrown when a modifying HTTP operation failed with a HTTP 403 status code, e.g. creating the intermediate folder,
 * or uploading/deleting the file.
 */
class NoPermissionError extends Error {
}

/**
 * Because fetch() throws weird, completely non-helpful exceptions such as TypeError with a message like
 * "NetworkError when attempting to fetch resource.", we just convert it to our own exception to have a cleaner
 * handling.
 */
class NetworkCommunicationError extends Error {
}

class BscwHttpClient {

    /**
     * Creates a new BscwHttpClient.
     * @param {BscwAccount} account
     */
    constructor(account) {
        this._account = account;
    }

    /**
     * Asks the user for credentials (or retrieves them from the LoginManager) and then performs a HTTP HEAD request to
     * baseURL and asks the user for the username and password in the process.
     * Should the credentials provided by the user be incorrect (401 response) and autoRetry is true, the user is
     * prompted to enter the credentials again.
     * Returns an object with username and password as keys. Throws exceptions NoValidCredentialsProvidedError,
     * CredentialsInvalidError, InvalidFolderError, NoPermissionError or NetworkCommunicationError
     * @param {boolean} autoRetry: if true, internally ask the user for new credentials again if they were wrong
     * @param {boolean} discardCachedCredentials: if true, already stored logins are deleted, to force a new dialog prompt
     * @returns {Promise<{username: (string), password: (string)}>}
     */
    async getAndCheckCredentials(autoRetry = true, discardCachedCredentials = false) {
        for (let i = 0; ; i++) {
            if (i > 0) {
                // Using the same cached (but obviously incorrect) credentials again and again would lead to an infinite
                // loop, so discard cached credentials in the 2nd, 3rd, ... loop iteration
                discardCachedCredentials = true;
            }
            // This call might throw an error (user aborted prompt) but we don't catch it on purpose!
            const credentials = await this._getCredentialsFromUserViaPrompt(discardCachedCredentials);

            try {
                await this._checkCredentials(credentials);
                return credentials;
            } catch (err) {
                if (err instanceof CredentialsInvalidError && autoRetry) {
                    continue
                }
                throw err;
            }
        }
    }

    /**
     * Uploads the provided file to BSCW (MKDIR of parent folder (named <isodate>), PUT file, followed by using the
     * publicURL REST API to retrieve a public link). Returns the public link.
     * Throws UploadAbortedError in case the upload was aborted by the user.
     * @param {number} id: random ID of the file, generated by Thunderbird
     * @param {string} name: name of the file, as it is on local disk
     * @param {File} data: file object
     * @returns {Promise<string>} the public link URL
     */
    async uploadFile(id, name, data) {
        const credentials = await this.getAndCheckCredentials(true, false);
        const parentDirName = await this._createParentDir(credentials);
        const privateAbsoluteFileUrl = await this._uploadFile(credentials, parentDirName, id, name, data);
        const publicUrl = await this._generatePublicFileUrl(credentials, parentDirName, name);
        finishedUploads.set(id, privateAbsoluteFileUrl);
        return publicUrl;
    }

    /**
     * Performs a DELETE call on the absolute path, in order to delete the file. Throws if something
     * goes wrong.
     * @param {string} absolutePath
     * @returns {Promise<void>}
     */
    async deleteFile(absolutePath) {
        const credentials = await this.getAndCheckCredentials(true, false);
        const fetchInfo = {
            method: "DELETE",
            headers: this._get_auth_header(credentials)
        };
        // Actually delete the parent directory, which implicitly deletes the contained file
        // TODO: at present, it seems that the public URL still works (BSCW-specific bug) - it's not a major issue,
        // since the URL also disappears from the Email, so it is unlikely that it is being leaked...
        const response = await this._fetchAndThrowIfError(this._parentPath(absolutePath), fetchInfo);
        this._throwErrorForStatusCodeIfNecessary(response);
    }

    /**
     * Checks whether the provided baseURL has a valid form, which is the case if it ends with bscw.cgi/<some number>
     * @param {string} baseURL: The baseURL to check, without any trailing slashes
     * @returns {boolean} true if the format is valid, false otherwise
     */
    static isValidBaseUrlFormat(baseURL) {
        const components = baseURL.split('/');
        if (components.length < 3) return false;
        if (isNaN(components[components.length - 1])) return false;
        return components[components.length - 2].endsWith("bscw.cgi");

    }

    /**
     * @param {{username: (string), password: (string)}} credentials
     * @returns {Promise<string>} the name of the parent directory
     */
    async _createParentDir(credentials) {
        const parentDirName = new Date().toISOString().replace(/[-:.Z]/g, "");

        const fetchInfo = {
            method: "MKCOL",
            headers: this._get_auth_header(credentials)
        };

        const url = this._account.baseURL + '/' + parentDirName;
        const response = await this._fetchAndThrowIfError(url, fetchInfo);
        this._throwErrorForStatusCodeIfNecessary(response);
        return parentDirName;
    }

    /**
     * Performs the PUT request and returns the absolute URL.
     * Throws UploadAbortedError in case the upload was aborted by the user.
     * @param {{username: (string), password: (string)}} credentials
     * @param {string} parentDirName: the name of the parent directory
     * @param {number} id: random ID of the file, generated by Thunderbird
     * @param {string} name: name of the file, as it is on local disk
     * @param {File} data: file object
     * @returns {Promise<string>} absolute URL of the uploaded file (is still a private(!) URL)
     */
    async _uploadFile(credentials, parentDirName, id, name, data) {
        let abortController = new AbortController();
        abortControllers.set(id, abortController);
        let fetchInfo = {
            signal: abortController.signal,
            method: "PUT",
            body: data,
            headers: this._get_auth_header(credentials)
        };
        const url = `${this._account.baseURL}/${parentDirName}/${encodeURIComponent(name)}`;
        try {
            const response = await this._fetchAndThrowIfError(url, fetchInfo);
            this._throwErrorForStatusCodeIfNecessary(response);
            return url;
        } finally {
            abortControllers.delete(id, abortController);
        }
    }

    /**
     * Generates the publicly accessible URL for the just-uploaded file. This is done by a POST request to the
     * "publicURL" REST API of BSCW, with a "timeout=<expiration in seconds" body.
     * @param {{username: (string), password: (string)}} credentials
     * @param {string} parentDirName: the name of the parent directory
     * @param {string} name: name of the file, as it is on local disk
     * @returns {Promise<string>} publicly accessible download URL for the file
     */
    async _generatePublicFileUrl(credentials, parentDirName, name) {
        const urlComponents = this._account.baseURL.split('/');
        const baseOid = urlComponents.pop();
        const baseUrlWithoutOid = urlComponents.join('/');
        const url = `${baseUrlWithoutOid}/REST/publicURL/${baseOid}/${parentDirName}/${encodeURIComponent(name)}`;

        const expirationInSeconds = this._account.expirationInDays * 24 * 60 * 60;
        const body = "timeout=" + expirationInSeconds;
        // Note: the customized Content-Type header is required to make BSCW parse the request properly
        const headers = {
            ...this._get_auth_header(credentials),
            "Content-Type": "application/x-www-form-urlencoded"
        };

        let fetchInfo = {
            method: "POST",
            body: body,
            headers: headers
        };

        const response = await this._fetchAndThrowIfError(url, fetchInfo);
        this._throwErrorForStatusCodeIfNecessary(response);
        try {
            const jsonBody = await response.json();
            return jsonBody.url;
        } catch (err) {
            throw new NetworkCommunicationError("Unable to parse publicURL REST API response from server, 'url' key " +
                "is missing, or invalid JSON was returned: " + err.message);
        }
    }

    /**
     * @param {string} absolutePath
     * @param {Object} fetchInfo
     * @returns {Promise<Response>}
     */
    async _fetchAndThrowIfError(absolutePath, fetchInfo) {
        try {
            return await fetch(absolutePath, fetchInfo);
        } catch (err) {
            const message = `Request to ${absolutePath} failed: ${err.message}`;
            if ("AbortError" === err.name) {
                throw new UploadAbortedError(message);
            }
            throw new NetworkCommunicationError(message);
        }
    }

    /**
     * Gets the user's credentials from a prompt (either using experimental API (LoginManager), or using a self-made
     * popup window.
     * In the first case, the class intelligently detects whether BscwHttpClient is run in privileged context (from
     * background.js), in which case direct access to the experimental API (browser.myLoginManager...) is possible.
     * If that is not the case, the API is indirectly invoked via messaging.
     * Throws NoValidCredentialsProvidedError in case the prompt was cancelled.
     *
     * @param {boolean} discardCachedCredentials: if true, already stored logins are deleted, to force a new dialog prompt
     * @returns {Promise<{username: (string), password: (string)}>}
     */
    async _getCredentialsFromUserViaPrompt(discardCachedCredentials) {
        if (this._account.loginHandlingOption === LoginHandlingOption.doNotSave) {
            let password = "";
            if (this._isRunningWithPrivilegedAccess()) {
                // browser.runtime.sendMessage() only works from content scripts - if we're running from a background.js
                // script, however, we must invoke the functionality directly
                password = await getPasswordFromPopup(this._account.baseURL, this._account.username);
            } else {
                // browser.windows.create() is not available in content scripts, thus we have to hand this task over to
                // the privileged background.js script via messaging
                password = await browser.runtime.sendMessage({
                    msgtype: MSGTYPE_INVOKE_PASSWORD_POPUP,
                    url: this._account.baseURL,
                    username: this._account.username
                });
            }

            //console.log("client _getCredentialsFromUserViaPrompt() received password " + password);
            if (password === "") {
                throw new NoValidCredentialsProvidedError();
            }
            return {username: this._account.username, password: password};
        }

        // else: use experimental mode
        let getCredentialsFunction;
        if (this._isRunningWithPrivilegedAccess()) {
            getCredentialsFunction = browser.myLoginManager.getAndStoreUsernameAndPassword;
        } else {
            getCredentialsFunction = this._getLoginManagerCredentialsViaMessaging;
        }
        try {
            const credentials = await getCredentialsFunction(this._account.baseURL, discardCachedCredentials);
            return credentials;
        } catch (err) {
            //console.log("_getCredentialsFromUserViaPrompt error");
            //console.log(err);
            // err is the IPC error thrown in the actual getAndStoreUsernameAndPassword method, with message
            // "Authorization prompt cancelled" - as far as we know, this is the only reason why that call could fail
            throw new NoValidCredentialsProvidedError()
        }

    }

    /**
     * @param {string} url
     * @param {boolean} discardCachedCredentials
     * @returns {Promise<{username: (string), password: (string)}>}
     */
    async _getLoginManagerCredentialsViaMessaging(url, discardCachedCredentials) {
        const credentials = await browser.runtime.sendMessage({
            msgtype: MSGTYPE_INVOKE_LOGIN_MANAGER,
            url: url,
            discardCachedCredentials: discardCachedCredentials
        });
        return credentials;
    }

    /**
     * Performs a HEAD request to determine whether the provided credentials are correct. Throws
     * NoValidCredentialsProvidedError if they are incorrect, or may also throw some other error if something else
     * went wrong during the HTTP request.
     * @param {{username: (string), password: (string)}} credentials
     * @returns {Promise<void>}
     */
    async _checkCredentials(credentials) {
        const fetchInfo = {
            method: "HEAD",
            headers: this._get_auth_header(credentials)
        };

        const response = await this._fetchAndThrowIfError(this._account.baseURL, fetchInfo);
        this._throwErrorForStatusCodeIfNecessary(response)
    }

    /**
     * @param {Object} credentials
     * @param {string} credentials.username
     * @param {string} credentials.password
     * @returns {{username: (string), password: (string)}}
     */
    _get_auth_header(credentials) {
        const authHeaderValue = "Basic " + btoa(credentials.username + ":" + credentials.password);
        return {Authorization: authHeaderValue};
    }

    /**
     * Returns the parentPath for absolutePath, e.g. "https://foo" for "https://foo/bar".
     * @param {string} absolutePath: path for which to build the parent
     * @returns {string} the parent path
     */
    _parentPath(absolutePath) {
        const segments = absolutePath.split('/');
        const lastSegmentLength = segments[segments.length - 1].length;
        return absolutePath.substring(0, absolutePath.length - (lastSegmentLength + 1)); // +1 to account for '/'
    }

    /**
     * @param {Response} response: the HTTP response
     */
    _throwErrorForStatusCodeIfNecessary(response) {
        if (response.ok) {
            return; //all good!
        }

        if (response.status === 401) {
            throw new CredentialsInvalidError();
        }

        if (response.status === 403) {
            throw new NoPermissionError();
        }

        if (response.status === 404) {
            throw new InvalidFolderError();
        }

        throw new NetworkCommunicationError("Invalid HTTP status code was " +
            "returned: " + response.status + ": " + response.statusText);
    }

    /**
     * Determines whether this client instance methods are invoked with privileged access (from background.js), in which
     * case it returns true, or from a content script (returns false).
     * @returns {boolean}
     */
    _isRunningWithPrivilegedAccess() {
        return "myLoginManager" in browser;
    }
}