const form = document.querySelector("form");
const baseUrl = form.baseUrl; // form.something selects the <input name="something">
const username = form.username;
const expiration = form.expiration;
const saveButton = form.querySelector("#save");
const verifyButton = form.querySelector("#verify");
const usernameForm = form.querySelector("#usernameForm");
const loginHandlingOption = form.loginHandlingOption;
const loginDoNotSaveInput = form.querySelector("#loginDoNotSave");
const loginSaveExperimentalInput = form.querySelector("#loginSaveExperimental");

let accountId = new URL(location.href).searchParams.get("accountId");
const bscwAccount = new BscwAccount(accountId);

let isFormDirty = false;

function setFormDirty(dirty) {
    isFormDirty = dirty;
    verifyButton.disabled = dirty;
    saveButton.disabled = !dirty;
}

async function prepopulateForm() {
    await bscwAccount.load();

    baseUrl.value = bscwAccount.baseURL;
    username.value = bscwAccount.username;
    if (bscwAccount.expirationInDays > 0) {
        expiration.value = bscwAccount.expirationInDays;
    }
    if (bscwAccount.loginHandlingOption === LoginHandlingOption.saveExperimental) {
        loginSaveExperimentalInput.checked = true;
    } else {
        loginDoNotSaveInput.checked = true;
    }
    handleLoginHandlingOptionChange(loginHandlingOption.value);

    setFormDirty(false);

    if (!bscwAccount.isComplete()) {
        verifyButton.disabled = true;
    }
}

(() => {
    // Apply internationalization of the dialog elements.
    // Do this in an anonymous function (which we call immediately) to properly scope local variables
    for (let element of document.querySelectorAll("[data-message]")) {
        element.innerHTML = browser.i18n.getMessage(element.dataset.message);
    }

    // Special handling for login handling
    loginDoNotSaveInput.value = LoginHandlingOption.doNotSave;
    loginSaveExperimentalInput.value = LoginHandlingOption.saveExperimental;
    for (let element of [loginDoNotSaveInput, loginSaveExperimentalInput]) {
        element.addEventListener('change', function () {
            handleLoginHandlingOptionChange(this.value);
            setFormDirty(true);
        });
    }

    for (let element of [baseUrl, username, expiration]) {
        element.addEventListener('input', function () {
            setFormDirty(true);
        });
    }

    // Fill the form fields using already-stored values
    prepopulateForm();
})();

/**
 * Shows the "username" part of the form if the user chooses option 1, otherwise hides it.
 * @param {string} newValue
 */
function handleLoginHandlingOptionChange(newValue) {
    usernameForm.hidden = (newValue === LoginHandlingOption.saveExperimental);
}

saveButton.onclick = async () => {
    // Let the form object verify whether all the required fields are actually filled
    if (!form.checkValidity()) {
        alert(browser.i18n.getMessage("someFormElementsInvalid"));
        return;
    }

    // Sanitize input
    document.querySelectorAll("input").forEach(element => {
        element.value = element.value.trim();
    });

    // Handle missing username
    if (username.value.length === 0 && loginHandlingOption.value === LoginHandlingOption.doNotSave) {
        alert(browser.i18n.getMessage("usernameMissingError"));
        return;
    }

    // Trim trailing slashes of baseURL, if there are any
    while (baseUrl.value.endsWith('/')) {
        baseUrl.value = baseUrl.value.substr(0, baseUrl.value.length - 1);
    }

    // Store data, even if it is not fully correct yet, to avoid data loss
    bscwAccount.username = username.value;
    bscwAccount.baseURL = baseUrl.value;
    bscwAccount.expirationInDays = expiration.value;
    bscwAccount.loginHandlingOption = loginHandlingOption.value;
    await bscwAccount.store();

    if (!BscwHttpClient.isValidBaseUrlFormat(baseUrl.value)) {
        alert(browser.i18n.getMessage("baseUrlFormatIncorrectError"));
    } else {
        await bscwAccount.updateConfigured();
        setFormDirty(false);
    }
};

verifyButton.onclick = async () => {
    const client = new BscwHttpClient(bscwAccount);
    const autoRetry = false;
    const discardCachedCredentials = true;
    verifyButton.disabled = true;
    try {
        await client.getAndCheckCredentials(autoRetry, discardCachedCredentials);
        alert(browser.i18n.getMessage("credentialsVerified"));
    } catch (err) {
        if (err instanceof NoValidCredentialsProvidedError) {
            // do nothing on purpose
        } else if (err instanceof CredentialsInvalidError) {
            alert(browser.i18n.getMessage("credentialsInvalidError"));
        } else if (err instanceof InvalidFolderError) {
            alert(browser.i18n.getMessage("invalidFolderError"));
        } else if (err instanceof NoPermissionError) {
            alert(browser.i18n.getMessage("noPermissionError"));
        } else if (err instanceof NetworkCommunicationError) {
            alert(browser.i18n.getMessage("networkCommunicationError"));
        } else {
            console.log("Unexpected error caught in management.js:");
            console.log(err);
            alert(browser.i18n.getMessage("unexpectedError"));
        }
    } finally {
        verifyButton.disabled = false;
    }
};
