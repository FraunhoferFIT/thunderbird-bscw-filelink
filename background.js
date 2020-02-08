// TODO license

//Maps from fileID (number) to the absolute path on the server
var finishedUploads = new Map();

//Maps from fileID (number) to the AbortController used in the upload-process of that file
var abortControllers = new Map();

let passwordResolver = null;

/**
 * @param {string} url
 * @param {string} username
 * @returns {Promise<string>}
 */
async function getPasswordFromPopup(url, username) {
    const popupURL = browser.extension.getURL("popup/getpassword.html"); // type: {string}
    // build the query string / search params - note that toString() also takes care of encoding special characters
    const searchParams = new URLSearchParams({"username": username, "url": url}).toString();
    const windowInfo = await browser.windows.create({
        url: `${popupURL}?${searchParams}`,
        type: "popup", // "popup" and "panel" look the same - should they look different?
        width: 700,
        height: 300,
        //titlePreface: "foobar" ignore, as TB doesn't care, it always shows "Loading ..." in the title anyways...
        allowScriptsToClose: true, // has no effect whatsoever, window.close() does NOT work in the script .. BUGS
    });

    // blocks until passwordResolver(pw) was called:
    const password = await new Promise((resolve) => {
        /*
        Note: we want the await-call to block until the password was received from the popup (or popup was closed).
        However, we cannot establish a new browser.runtime.onMessage listener inside a listener. Thus, we have to
        use this listener (handleContentScriptMessages) and leak the resolve function of this promise. This isn't
        very clean, but is still nicer than using setTimeout() calls to wait for a global password variable change.
         */
        passwordResolver = resolve;
    });
    //console.log("Received password: " + password);
    // Closing window by force here, because window.close() from within the popup doesn't do anything (bugs bugs bugs)
    await browser.windows.remove(windowInfo.id);
    return password;
}

/**
 * Handles the calls to privileged functionality (which only the background.js file may do), such as calls to
 * experimental APIs, or browser.windows...
 * The return value depends on the message.
 * @param message
 * @returns {Promise<>}
 */
async function handleContentScriptMessages(message) {
    //console.log("handleContentScriptMessages() was called with message");
    //console.log(message);
    if (message.msgtype === MSGTYPE_INVOKE_LOGIN_MANAGER) {
        try {
            const credentials = await browser.myLoginManager.getAndStoreUsernameAndPassword(message.url, message.discardCachedCredentials);
            return Promise.resolve(credentials);
        } catch (err) {
            //console.log("handleContentScriptMessages: received error:");
            //console.log(err);
            // Promise.reject() will cause the "await browser.runtime.sendMessage()" call to throw
            return Promise.reject(err);
        }
    } else if (message.msgtype === MSGTYPE_INVOKE_PASSWORD_POPUP) {
        const password = await getPasswordFromPopup(message.username, message.url);
        return Promise.resolve(password);
    } else if (message.msgtype === MSGTYPE_PASSWORD_POPUP_RESPONSE) {
        if (passwordResolver != null) {
            passwordResolver(message.password);
            passwordResolver = null;
        }
        return Promise.resolve();
    }
}

browser.runtime.onMessage.addListener(handleContentScriptMessages);

/* Handle the functions documented on https://thunderbird-webextensions.readthedocs.io/en/68/cloudFile.html#functions */

// Whenever TB starts, all the providers are in state configured:false -> make sure they are configured again:
browser.cloudFile.getAllAccounts().then(async (fileLinkAccounts) => {
    for (let fileLinkAccount of fileLinkAccounts) {
        const bscwAccount = new BscwAccount(fileLinkAccount.id);
        await bscwAccount.load();
        await bscwAccount.updateConfigured();
    }
});

// Note: the messages/stacktraces of any Error objects we throw in the listeners defined below are not visible to the
// user. The user only sees a small dialog with a message like "Unable to upload <filename> to <FileLink account name>."
// with no further details being provided!

browser.cloudFile.onFileUpload.addListener(async (fileLinkAccount, {id, name, data}) => {
    // "id" is a unique File ID (numeric), "name" is the file name (as it is on disk), "data" is a File object
    const bscwAccount = new BscwAccount(fileLinkAccount.id);
    await bscwAccount.load();
    if (!bscwAccount.isComplete()) {
        throw new Error("Account is not completely configured yet!");
    }

    const client = new BscwHttpClient(bscwAccount);

    try {
        const publicURL = await client.uploadFile(id, name, data);
        return {aborted: false, url: publicURL};
    } catch (err) {
        if (err instanceof UploadAbortedError) {
            return {aborted: true, url: ""};
        }
        throw err;
    }

});


browser.cloudFile.onFileUploadAbort.addListener(
    (account, fileId) => {
        const abortController = abortControllers.get(fileId);
        if (abortController) {
            abortController.abort();
        }
    });


browser.cloudFile.onFileDeleted.addListener(async (fileLinkAccount, id) => {
    // "id" is the random file ID generated by Thunderbird
    const absPath = finishedUploads.get(id);
    if (!absPath) {
        // For some reason, that file with that ID was never successfully uploaded ...
        return;
    }

    // TODO: Show a window that asks the user whether to delete the file from server, too? For now, always delete it

    finishedUploads.delete(id);

    const bscwAccount = new BscwAccount(fileLinkAccount.id);
    await bscwAccount.load();
    if (!bscwAccount.isComplete()) {
        return; // should never happen, but check it anyway ;)
    }

    const client = new BscwHttpClient(bscwAccount);

    try {
        await client.deleteFile(absPath);
    } catch (err) {
        // Fail silently on purpose - the delete operation cannot be repeated by the user anyway
    }
});


browser.cloudFile.onAccountDeleted.addListener(async accountId => {
    const bscwAccount = new BscwAccount(accountId);
    await bscwAccount.deleteAccount();
});
