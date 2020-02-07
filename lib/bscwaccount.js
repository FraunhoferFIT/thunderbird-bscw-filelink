_EXPIRATION_KEY = "expiration";
_BASE_URL_KEY = "baseURL";
_USERNAME_KEY = "username";
_LOGIN_HANDLING_OPTION_KEY = "loginHandling";

const LoginHandlingOption = {
    doNotSave: "doNotSave",
    saveExperimental: "saveExperimental"
};

class BscwAccount {

    constructor(accountId) {
        this.accountId = accountId;
        this.username = "";
        this.baseURL = "";
        this.expirationInDays = 0;
        this.loginHandlingOption = LoginHandlingOption.saveExperimental;
    }

    /**
     * Loads data from local storage API into this object (if any data exists).
     */
    async load() {
        // See https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/StorageArea for
        // further documentation of the "browser.storage.local" methods
        const accountInfo = await browser.storage.local.get();
        // accountInfo is a dict that maps from every accountID string (only of accounts of THIS plugin!) to a JS
        // object with our own self-defined keys and values
        if (this.accountId in accountInfo) {
            this.username = accountInfo[this.accountId][_USERNAME_KEY];
            this.baseURL = accountInfo[this.accountId][_BASE_URL_KEY];
            this.expirationInDays = accountInfo[this.accountId][_EXPIRATION_KEY];
            this.loginHandlingOption = accountInfo[this.accountId][_LOGIN_HANDLING_OPTION_KEY];
        }
    }

    async store() {
        var localStorageObj = {};
        localStorageObj[_USERNAME_KEY] = this.username;
        localStorageObj[_BASE_URL_KEY] = this.baseURL;
        localStorageObj[_EXPIRATION_KEY] = this.expirationInDays;
        localStorageObj[_LOGIN_HANDLING_OPTION_KEY] = this.loginHandlingOption;

        await browser.storage.local.set({[this.accountId]: localStorageObj,});
    }

    async updateConfigured() {
        browser.cloudFile.updateAccount(this.accountId, {configured: this.isComplete(),});
    }

    async deleteAccount() {
        await browser.storage.local.remove(this.accountId);
    }

    isComplete() {
        const firstCheck = Boolean(this.baseURL) && BscwHttpClient.isValidBaseUrlFormat(this.baseURL)
            && this.expirationInDays > 0;

        if (!firstCheck) return false;

        if (this.loginHandlingOption === LoginHandlingOption.doNotSave) {
            return Boolean(this.username)
        }
        return true;
    }
}