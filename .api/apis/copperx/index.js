"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var oas_1 = __importDefault(require("oas"));
var core_1 = __importDefault(require("api/dist/core"));
var openapi_json_1 = __importDefault(require("./openapi.json"));
var SDK = /** @class */ (function () {
    function SDK() {
        this.spec = oas_1.default.init(openapi_json_1.default);
        this.core = new core_1.default(this.spec, 'copperx/v0.0.0 (api/6.1.3)');
    }
    /**
     * Optionally configure various options that the SDK allows.
     *
     * @param config Object of supported SDK options and toggles.
     * @param config.timeout Override the default `fetch` request timeout of 30 seconds. This number
     * should be represented in milliseconds.
     */
    SDK.prototype.config = function (config) {
        this.core.setConfig(config);
    };
    /**
     * If the API you're using requires authentication you can supply the required credentials
     * through this method and the library will magically determine how they should be used
     * within your API request.
     *
     * With the exception of OpenID and MutualTLS, it supports all forms of authentication
     * supported by the OpenAPI specification.
     *
     * @example <caption>HTTP Basic auth</caption>
     * sdk.auth('username', 'password');
     *
     * @example <caption>Bearer tokens (HTTP or OAuth 2)</caption>
     * sdk.auth('myBearerToken');
     *
     * @example <caption>API Keys</caption>
     * sdk.auth('myApiKey');
     *
     * @see {@link https://spec.openapis.org/oas/v3.0.3#fixed-fields-22}
     * @see {@link https://spec.openapis.org/oas/v3.1.0#fixed-fields-22}
     * @param values Your auth credentials for the API; can specify up to two strings or numbers.
     */
    SDK.prototype.auth = function () {
        var _a;
        var values = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            values[_i] = arguments[_i];
        }
        (_a = this.core).setAuth.apply(_a, values);
        return this;
    };
    /**
     * If the API you're using offers alternate server URLs, and server variables, you can tell
     * the SDK which one to use with this method. To use it you can supply either one of the
     * server URLs that are contained within the OpenAPI definition (along with any server
     * variables), or you can pass it a fully qualified URL to use (that may or may not exist
     * within the OpenAPI definition).
     *
     * @example <caption>Server URL with server variables</caption>
     * sdk.server('https://{region}.api.example.com/{basePath}', {
     *   name: 'eu',
     *   basePath: 'v14',
     * });
     *
     * @example <caption>Fully qualified server URL</caption>
     * sdk.server('https://eu.api.example.com/v14');
     *
     * @param url Server URL
     * @param variables An object of variables to replace into the server URL.
     */
    SDK.prototype.server = function (url, variables) {
        if (variables === void 0) { variables = {}; }
        this.core.setServer(url, variables);
    };
    SDK.prototype.storageFileController_post = function (body, metadata) {
        return this.core.fetch('/api/v1/storage/files/{storageType}', 'post', body, metadata);
    };
    /** @throws FetchError<500, types.AuthControllerGetCurrentUserResponse500> */
    SDK.prototype.authController_getCurrentUser = function () {
        return this.core.fetch('/api/v1/auth/me', 'get');
    };
    /** @throws FetchError<500, types.AuthControllerGetPointsAccessTokenResponse500> */
    SDK.prototype.authController_getPointsAccessToken = function () {
        return this.core.fetch('/api/v1/auth/points-token', 'post');
    };
    /**
     * Returns the organization info
     *
     * @summary Get organization info
     * @throws FetchError<500, types.OrganizationControllerGetOrganizationInfoResponse500>
     */
    SDK.prototype.organizationController_getOrganizationInfo = function () {
        return this.core.fetch('/api/v1/organization', 'get');
    };
    /**
     * Updates the organization branding which will be reflected on payment pages, invoices,
     * etc.
     *
     * @summary Update branding
     * @throws FetchError<500, types.OrganizationControllerUpdateBrandingResponse500>
     */
    SDK.prototype.organizationController_updateBranding = function (body) {
        return this.core.fetch('/api/v1/organization/brand', 'put', body);
    };
    /**
     * Delete Brand Logo
     *
     * @summary Delete Brand Logo
     * @throws FetchError<500, types.OrganizationControllerDeleteBrandLogoResponse500>
     */
    SDK.prototype.organizationController_deleteBrandLogo = function () {
        return this.core.fetch('/api/v1/organization/brand-logo', 'delete');
    };
    /**
     * Returns the list of users
     *
     * @summary List of users
     * @throws FetchError<500, types.UserControllerGetUsersResponse500>
     */
    SDK.prototype.userController_getUsers = function () {
        return this.core.fetch('/api/v1/users', 'get');
    };
    /**
     * Deletes a user
     *
     * @summary Delete a user
     * @throws FetchError<500, types.UserControllerDeleteUserResponse500>
     */
    SDK.prototype.userController_deleteUser = function (metadata) {
        return this.core.fetch('/api/v1/users/{id}', 'delete', metadata);
    };
    /**
     * Updates a user role
     *
     * @summary Update a user role
     * @throws FetchError<500, types.UserControllerUpdateUserRoleResponse500>
     */
    SDK.prototype.userController_updateUserRole = function (body, metadata) {
        return this.core.fetch('/api/v1/users/{id}/role', 'put', body, metadata);
    };
    /**
     * Returns the list of withdrawal addresses
     *
     * @summary List of withdrawal addresses
     * @throws FetchError<500, types.WithdrawalAddressControllerGetAllResponse500>
     */
    SDK.prototype.withdrawalAddressController_getAll = function () {
        return this.core.fetch('/api/v1/organization/withdrawal-addresses', 'get');
    };
    /**
     * Withdrawal Addresses are used to receive funds from the platform. You can create as many
     * withdrawal addresses you want, but only one can be marked as default.
     *
     * @summary Create a withdrawal address
     * @throws FetchError<500, types.WithdrawalAddressControllerCreateResponse500>
     */
    SDK.prototype.withdrawalAddressController_create = function (body) {
        return this.core.fetch('/api/v1/organization/withdrawal-addresses', 'post', body);
    };
    /**
     * Returns a withdrawal address
     *
     * @summary Get a withdrawal address
     * @throws FetchError<500, types.WithdrawalAddressControllerGetResponse500>
     */
    SDK.prototype.withdrawalAddressController_get = function (metadata) {
        return this.core.fetch('/api/v1/organization/withdrawal-addresses/{id}', 'get', metadata);
    };
    /**
     * Updates a withdrawal address
     *
     * @summary Update a withdrawal address
     * @throws FetchError<500, types.WithdrawalAddressControllerUpdateResponse500>
     */
    SDK.prototype.withdrawalAddressController_update = function (body, metadata) {
        return this.core.fetch('/api/v1/organization/withdrawal-addresses/{id}', 'put', body, metadata);
    };
    /**
     * Deletes a withdrawal address. If you delete your default address, then the first address
     * will be marked as default and you will receive next payments to that address.
     *
     * @summary Delete a withdrawal address
     * @throws FetchError<500, types.WithdrawalAddressControllerDeleteResponse500>
     */
    SDK.prototype.withdrawalAddressController_delete = function (metadata) {
        return this.core.fetch('/api/v1/organization/withdrawal-addresses/{id}', 'delete', metadata);
    };
    /**
     * Marks a withdrawal address as default.
     *
     * @summary Mark a withdrawal address as default
     * @throws FetchError<500, types.WithdrawalAddressControllerMarkAsDefaultResponse500>
     */
    SDK.prototype.withdrawalAddressController_markAsDefault = function (metadata) {
        return this.core.fetch('/api/v1/organization/withdrawal-addresses/{id}/mark-as-default', 'post', metadata);
    };
    /**
     * Returns payment setting info
     *
     * @summary Get payment setting info
     * @throws FetchError<500, types.PaymentSettingControllerGetResponse500>
     */
    SDK.prototype.paymentSettingController_get = function () {
        return this.core.fetch('/api/v1/organization/payment-setting', 'get');
    };
    /**
     * Returns invoice setting info
     *
     * @summary Get invoice setting info
     * @throws FetchError<500, types.InvoiceSettingControllerGetResponse500>
     */
    SDK.prototype.invoiceSettingController_get = function () {
        return this.core.fetch('/api/v1/organization/invoice-setting', 'get');
    };
    /**
     * Returns the list of user invites
     *
     * @summary List of user invites
     * @throws FetchError<500, types.UserInviteControllerGetInvitesResponse500>
     */
    SDK.prototype.userInviteController_getInvites = function () {
        return this.core.fetch('/api/v1/invites', 'get');
    };
    /**
     * Invite a user
     *
     * @summary Invite a user
     * @throws FetchError<500, types.UserInviteControllerInviteUserResponse500>
     */
    SDK.prototype.userInviteController_inviteUser = function (body) {
        return this.core.fetch('/api/v1/invites', 'post', body);
    };
    /**
     * Remove user invitation
     *
     * @summary Remove user invitation
     * @throws FetchError<500, types.UserInviteControllerRemoveInviteResponse500>
     */
    SDK.prototype.userInviteController_removeInvite = function (metadata) {
        return this.core.fetch('/api/v1/invites/{id}', 'delete', metadata);
    };
    /**
     * Resend user invitation
     *
     * @summary Resend user invitation
     * @throws FetchError<500, types.UserInviteControllerResendInviteResponse500>
     */
    SDK.prototype.userInviteController_resendInvite = function (metadata) {
        return this.core.fetch('/api/v1/invites/{id}/resend', 'post', metadata);
    };
    /**
     * Checkout Sessions allow you to create one-off payments in a fixed or variable amount or
     * start subscriptions for your customers. You should create a new Checkout Session for
     * each payment attempt. Once you create a Checkout Session on your server, you need to
     * redirect user to the Checkout Session URL to complete the payment flow.
     *
     * @summary Create a new checkout session
     * @throws FetchError<401, types.SessionsControllerCreateResponse401>
     * @throws FetchError<500, types.SessionsControllerCreateResponse500>
     */
    SDK.prototype.sessionsController_create = function (body) {
        return this.core.fetch('/api/v1/checkout/sessions', 'post', body);
    };
    /**
     * Returns ths list of checkout sessions
     *
     * @summary List of checkout sessions
     * @throws FetchError<500, types.SessionsControllerFindAllResponse500>
     */
    SDK.prototype.sessionsController_findAll = function (metadata) {
        return this.core.fetch('/api/v1/checkout/sessions', 'get', metadata);
    };
    /**
     * Auto recover the status of checkout session with its transaction hash
     *
     * @summary Auto recover the status of checkout session by transaction hash
     * @throws FetchError<500, types.SessionsControllerAutoRecoverCheckoutSessionByHashResponse500>
     */
    SDK.prototype.sessionsController_autoRecoverCheckoutSessionByHash = function (body) {
        return this.core.fetch('/api/v1/checkout/sessions/auto-recover-by-transaction-hash', 'post', body);
    };
    /**
     * Returns a excel file of checkout sessions
     *
     * @summary Export checkout sessions
     * @throws FetchError<500, types.SessionsControllerExportCheckoutSessionsResponse500>
     */
    SDK.prototype.sessionsController_exportCheckoutSessions = function (metadata) {
        return this.core.fetch('/api/v1/checkout/sessions/export', 'get', metadata);
    };
    /**
     * Returns a checkout session
     *
     * @summary Get a checkout session
     * @throws FetchError<500, types.SessionsControllerFindOneResponse500>
     */
    SDK.prototype.sessionsController_findOne = function (metadata) {
        return this.core.fetch('/api/v1/checkout/sessions/{id}', 'get', metadata);
    };
    /**
     * Returns only a status of checkout session with its transaction hash
     *
     * @summary Get the status of checkout session
     * @throws FetchError<500, types.SessionsControllerCheckoutSessionCompletedStatusResponse500>
     */
    SDK.prototype.sessionsController_checkoutSessionCompletedStatus = function (metadata) {
        return this.core.fetch('/api/v1/checkout/sessions/{id}/completed_webhook_delivered', 'get', metadata);
    };
    /**
     * Auto recover the status of checkout session with its transaction hash
     *
     * @summary Auto recover the status of checkout session
     * @throws FetchError<500, types.SessionsControllerAutoRecoverCheckoutSessionResponse500>
     */
    SDK.prototype.sessionsController_autoRecoverCheckoutSession = function (body, metadata) {
        return this.core.fetch('/api/v1/checkout/sessions/{id}/auto-recover', 'post', body, metadata);
    };
    /**
     * Complete checkout session with incomplete payment
     *
     * @summary Complete checkout session with incomplete payment
     * @throws FetchError<500, types.SessionsControllerCompletePartialCheckoutSessionResponse500>
     */
    SDK.prototype.sessionsController_completePartialCheckoutSession = function (metadata) {
        return this.core.fetch('/api/v1/checkout/sessions/{id}/complete-partial-checkout-session', 'post', metadata);
    };
    /**
     * Create a payment link to accept payments from customers. You can accept payments in a
     * fixed or variable amount from your customers. Whether you are doing a freelancing,
     * running a crowdfunding campaign, accept donations, or just looking for a simple way to
     * build patrons via crypto, these payment links are the perfect solution.
     *
     * @summary Create a payment link
     * @throws FetchError<500, types.PaymentLinkControllerCreateResponse500>
     */
    SDK.prototype.paymentLinkController_create = function (body) {
        return this.core.fetch('/api/v1/payment-links', 'post', body);
    };
    /**
     * Returns the list of payment links
     *
     * @summary List of payment links
     * @throws FetchError<500, types.PaymentLinkControllerFindAllResponse500>
     */
    SDK.prototype.paymentLinkController_findAll = function (metadata) {
        return this.core.fetch('/api/v1/payment-links', 'get', metadata);
    };
    /**
     * Returns a payment link
     *
     * @summary Get a payment link
     * @throws FetchError<500, types.PaymentLinkControllerGetResponse500>
     */
    SDK.prototype.paymentLinkController_get = function (metadata) {
        return this.core.fetch('/api/v1/payment-links/{linkId}', 'get', metadata);
    };
    /**
     * Updates a payment link
     *
     * @summary Update a payment link
     * @throws FetchError<500, types.PaymentLinkControllerUpdateResponse500>
     */
    SDK.prototype.paymentLinkController_update = function (body, metadata) {
        return this.core.fetch('/api/v1/payment-links/{linkId}', 'put', body, metadata);
    };
    /**
     * Deletes a payment link
     *
     * @summary Delete a payment link
     * @throws FetchError<500, types.PaymentLinkControllerDeleteResponse500>
     */
    SDK.prototype.paymentLinkController_delete = function (metadata) {
        return this.core.fetch('/api/v1/payment-links/{linkId}', 'delete', metadata);
    };
    /**
     * Activate a payment link
     *
     * @summary Activate a payment link
     * @throws FetchError<500, types.PaymentLinkControllerActivateResponse500>
     */
    SDK.prototype.paymentLinkController_activate = function (metadata) {
        return this.core.fetch('/api/v1/payment-links/{linkId}/activate', 'put', metadata);
    };
    /**
     * Deactivate a payment link
     *
     * @summary Deactivate a payment link
     * @throws FetchError<500, types.PaymentLinkControllerDeactivateResponse500>
     */
    SDK.prototype.paymentLinkController_deactivate = function (metadata) {
        return this.core.fetch('/api/v1/payment-links/{linkId}/deactivate', 'put', metadata);
    };
    /**
     * Creates a price with product
     *
     * @summary Create a price
     * @throws FetchError<500, types.PriceControllerCreateResponse500>
     */
    SDK.prototype.priceController_create = function (body) {
        return this.core.fetch('/api/v1/prices', 'post', body);
    };
    /**
     * Returns the list of prices
     *
     * @summary List of prices
     * @throws FetchError<500, types.PriceControllerFindAllResponse500>
     */
    SDK.prototype.priceController_findAll = function (metadata) {
        return this.core.fetch('/api/v1/prices', 'get', metadata);
    };
    /**
     * Returns a price
     *
     * @summary Get a price
     * @throws FetchError<500, types.PriceControllerGetResponse500>
     */
    SDK.prototype.priceController_get = function (metadata) {
        return this.core.fetch('/api/v1/prices/{id}', 'get', metadata);
    };
    /**
     * Updates a price nickname and metadata
     *
     * @summary Update a price
     * @throws FetchError<500, types.PriceControllerUpdateResponse500>
     */
    SDK.prototype.priceController_update = function (body, metadata) {
        return this.core.fetch('/api/v1/prices/{id}', 'put', body, metadata);
    };
    /**
     * Creates a product
     *
     * @summary Create a product
     * @throws FetchError<500, types.ProductControllerCreateResponse500>
     */
    SDK.prototype.productController_create = function (body) {
        return this.core.fetch('/api/v1/products', 'post', body);
    };
    /**
     * Returns the list of products
     *
     * @summary List of products
     * @throws FetchError<500, types.ProductControllerFindAllResponse500>
     */
    SDK.prototype.productController_findAll = function (metadata) {
        return this.core.fetch('/api/v1/products', 'get', metadata);
    };
    /**
     * Returns a product
     *
     * @summary Get a product
     * @throws FetchError<500, types.ProductControllerGetResponse500>
     */
    SDK.prototype.productController_get = function (metadata) {
        return this.core.fetch('/api/v1/products/{id}', 'get', metadata);
    };
    /**
     * Updates a product information
     *
     * @summary Update a product
     * @throws FetchError<500, types.ProductControllerUpdateResponse500>
     */
    SDK.prototype.productController_update = function (body, metadata) {
        return this.core.fetch('/api/v1/products/{id}', 'put', body, metadata);
    };
    /**
     * Deletes a product
     *
     * @summary Delete a product
     * @throws FetchError<500, types.ProductControllerDeleteResponse500>
     */
    SDK.prototype.productController_delete = function (metadata) {
        return this.core.fetch('/api/v1/products/{id}', 'delete', metadata);
    };
    /**
     * Activate a product
     *
     * @summary Activate a product
     * @throws FetchError<500, types.ProductControllerActivateResponse500>
     */
    SDK.prototype.productController_activate = function (metadata) {
        return this.core.fetch('/api/v1/products/{id}/activate', 'put', metadata);
    };
    /**
     * Deactivate a product
     *
     * @summary Deactivate a product
     * @throws FetchError<500, types.ProductControllerDeactivateResponse500>
     */
    SDK.prototype.productController_deactivate = function (metadata) {
        return this.core.fetch('/api/v1/products/{id}/deactivate', 'put', metadata);
    };
    /**
     * Returns the list of subscriptions
     *
     * @summary List of subscriptions
     * @throws FetchError<500, types.SubscriptionControllerFindAllResponse500>
     */
    SDK.prototype.subscriptionController_findAll = function (metadata) {
        return this.core.fetch('/api/v1/subscriptions', 'get', metadata);
    };
    /**
     * Returns a subscription
     *
     * @summary Get a subscription
     * @throws FetchError<500, types.SubscriptionControllerGetResponse500>
     */
    SDK.prototype.subscriptionController_get = function (metadata) {
        return this.core.fetch('/api/v1/subscriptions/{id}', 'get', metadata);
    };
    /**
     * Cancel a subscription. It does not end the subscription, but it will be canceled at the
     * end of the period.
     *
     * @summary Cancel a subscription
     * @throws FetchError<500, types.SubscriptionControllerCancelResponse500>
     */
    SDK.prototype.subscriptionController_cancel = function (body, metadata) {
        return this.core.fetch('/api/v1/subscriptions/{id}/cancel', 'post', body, metadata);
    };
    /**
     * Resume a subscription. It resumes the subscription that is scheduled be cancel at the
     * end of the period.
     *
     * @summary Resume a subscription
     * @throws FetchError<500, types.SubscriptionControllerResumeResponse500>
     */
    SDK.prototype.subscriptionController_resume = function (metadata) {
        return this.core.fetch('/api/v1/subscriptions/{id}/resume', 'post', metadata);
    };
    /**
     * Cancel a subscription. It ends the subscription immediately and no refund is made.
     *
     * @summary Cancel a subscription immediately
     * @throws FetchError<500, types.SubscriptionControllerEndResponse500>
     */
    SDK.prototype.subscriptionController_end = function (body, metadata) {
        return this.core.fetch('/api/v1/subscriptions/{id}/end', 'post', body, metadata);
    };
    /**
     * Creates as invoice
     *
     * @summary Create an invoice
     * @throws FetchError<500, types.InvoiceControllerCreateResponse500>
     */
    SDK.prototype.invoiceController_create = function (body) {
        return this.core.fetch('/api/v1/invoices', 'post', body);
    };
    /**
     * Returns the list of all invoices
     *
     * @summary List of all invoices
     * @throws FetchError<500, types.InvoiceControllerGetAllResponse500>
     */
    SDK.prototype.invoiceController_getAll = function (metadata) {
        return this.core.fetch('/api/v1/invoices', 'get', metadata);
    };
    /**
     * Returns an invoice
     *
     * @summary Get an invoice
     * @throws FetchError<500, types.InvoiceControllerGetResponse500>
     */
    SDK.prototype.invoiceController_get = function (metadata) {
        return this.core.fetch('/api/v1/invoices/{id}', 'get', metadata);
    };
    /**
     * Creates a draft invoice
     *
     * @summary Update a draft invoice
     * @throws FetchError<500, types.InvoiceControllerUpdateResponse500>
     */
    SDK.prototype.invoiceController_update = function (body, metadata) {
        return this.core.fetch('/api/v1/invoices/{id}', 'put', body, metadata);
    };
    /**
     * Deletes a draft invoice. If invoice is not in draft state, it should be voided and can
     * not be deleted.
     *
     * @summary Delete a draft invoice
     * @throws FetchError<500, types.InvoiceControllerDeleteResponse500>
     */
    SDK.prototype.invoiceController_delete = function (metadata) {
        return this.core.fetch('/api/v1/invoices/{id}', 'delete', metadata);
    };
    /**
     * Duplicate an invoice using the incoming invoice id.
     *
     * @summary Duplicate an invoice
     * @throws FetchError<500, types.InvoiceControllerDuplicateInvoiceResponse500>
     */
    SDK.prototype.invoiceController_duplicateInvoice = function (metadata) {
        return this.core.fetch('/api/v1/invoices/{id}/duplicate', 'post', metadata);
    };
    /**
     * Void an invoice. If an invoice is paid then it can not be voided.
     *
     * @summary Void an invoice
     * @throws FetchError<500, types.InvoiceControllerVoidInvoiceResponse500>
     */
    SDK.prototype.invoiceController_voidInvoice = function (metadata) {
        return this.core.fetch('/api/v1/invoices/{id}/void', 'post', metadata);
    };
    /**
     * Mark an invoice as uncollectible. If an invoice is paid then it can not be marked as
     * uncollectible.
     *
     * @summary Mark an invoice as uncollectible
     * @throws FetchError<500, types.InvoiceControllerMarkUncollectibleInvoiceResponse500>
     */
    SDK.prototype.invoiceController_markUncollectibleInvoice = function (metadata) {
        return this.core.fetch('/api/v1/invoices/{id}/mark-uncollectible', 'post', metadata);
    };
    /**
     * Finalize an invoice.
     *
     * @summary Finalize an invoice
     * @throws FetchError<500, types.InvoiceControllerFinalizeInvoiceResponse500>
     */
    SDK.prototype.invoiceController_finalizeInvoice = function (metadata) {
        return this.core.fetch('/api/v1/invoices/{id}/finalize', 'post', metadata);
    };
    /**
     * Send email to customer. Finalize an invoice if not finalized.
     *
     * @summary Send email to customer. Finalize an invoice if not finalized.
     * @throws FetchError<500, types.InvoiceControllerFinalizeAndSendInvoiceResponse500>
     */
    SDK.prototype.invoiceController_finalizeAndSendInvoice = function (body, metadata) {
        return this.core.fetch('/api/v1/invoices/{id}/send', 'post', body, metadata);
    };
    /**
     * Mark an open invoice as paid.
     *
     * @summary Mark an open invoice as paid.
     * @throws FetchError<500, types.InvoiceControllerPayInvoiceResponse500>
     */
    SDK.prototype.invoiceController_payInvoice = function (metadata) {
        return this.core.fetch('/api/v1/invoices/{id}/pay', 'post', metadata);
    };
    /**
     * Creates a customer
     *
     * @summary Create a customer
     * @throws FetchError<500, types.CustomerControllerCreateResponse500>
     */
    SDK.prototype.customerController_create = function (body) {
        return this.core.fetch('/api/v1/customers', 'post', body);
    };
    /**
     * Returns the list of customers
     *
     * @summary List of customers
     * @throws FetchError<500, types.CustomerControllerFindAllResponse500>
     */
    SDK.prototype.customerController_findAll = function (metadata) {
        return this.core.fetch('/api/v1/customers', 'get', metadata);
    };
    /**
     * Returns a customer
     *
     * @summary Get a customer
     * @throws FetchError<500, types.CustomerControllerGetResponse500>
     */
    SDK.prototype.customerController_get = function (metadata) {
        return this.core.fetch('/api/v1/customers/{id}', 'get', metadata);
    };
    /**
     * Updates a customer email, phone, address, etc.
     *
     * @summary Update a customer
     * @throws FetchError<500, types.CustomerControllerUpdateResponse500>
     */
    SDK.prototype.customerController_update = function (body, metadata) {
        return this.core.fetch('/api/v1/customers/{id}', 'put', body, metadata);
    };
    /**
     * Deletes a customer
     *
     * @summary Delete a customer
     * @throws FetchError<500, types.CustomerControllerDeleteResponse500>
     */
    SDK.prototype.customerController_delete = function (metadata) {
        return this.core.fetch('/api/v1/customers/{id}', 'delete', metadata);
    };
    /**
     * Returns the list of transactions
     *
     * @summary List of transactions
     * @throws FetchError<500, types.TransactionControllerFindAllResponse500>
     */
    SDK.prototype.transactionController_findAll = function (metadata) {
        return this.core.fetch('/api/v1/transactions', 'get', metadata);
    };
    /**
     * Returns the list of assets
     *
     * @summary List of assets
     * @throws FetchError<500, types.AssetControllerFindAllResponse500>
     */
    SDK.prototype.assetController_findAll = function (metadata) {
        return this.core.fetch('/api/v1/assets', 'get', metadata);
    };
    /**
     * Returns an asset
     *
     * @summary Get an asset
     * @throws FetchError<500, types.AssetControllerGetResponse500>
     */
    SDK.prototype.assetController_get = function (metadata) {
        return this.core.fetch('/api/v1/assets/{id}', 'get', metadata);
    };
    /**
     * Returns the list of chains with assets
     *
     * @summary List of chains
     * @throws FetchError<500, types.ChainControllerFindAllResponse500>
     */
    SDK.prototype.chainController_findAll = function (metadata) {
        return this.core.fetch('/api/v1/chains', 'get', metadata);
    };
    /**
     * Returns a chain with assets
     *
     * @summary Get a chain
     * @throws FetchError<500, types.ChainControllerGetResponse500>
     */
    SDK.prototype.chainController_get = function (metadata) {
        return this.core.fetch('/api/v1/chains/{id}', 'get', metadata);
    };
    /**
     * Send payment receipt email to customer.
     *
     * @summary Send payment receipt email to customer.
     * @throws FetchError<500, types.PaymentIntentControllerSendCheckoutSessionPaymentReceiptResponse500>
     */
    SDK.prototype.paymentIntentController_sendCheckoutSessionPaymentReceipt = function (metadata) {
        return this.core.fetch('/api/v1/payment-intents/{paymentIntentId}/payment-receipts/send', 'post', metadata);
    };
    /**
     * Mark payment as refunded
     *
     * @summary Mark payment as refunded
     * @throws FetchError<500, types.PaymentIntentControllerMarkAsRefundedResponse500>
     */
    SDK.prototype.paymentIntentController_markAsRefunded = function (body, metadata) {
        return this.core.fetch('/api/v1/payment-intents/{paymentIntentId}/mark-as-refund', 'post', body, metadata);
    };
    /**
     * Returns the list of coupons
     *
     * @summary List of coupons
     * @throws FetchError<500, types.CouponControllerSearchResponse500>
     */
    SDK.prototype.couponController_search = function (metadata) {
        return this.core.fetch('/api/v1/coupons', 'get', metadata);
    };
    /**
     * Creates a coupon
     *
     * @summary Create a coupon
     * @throws FetchError<500, types.CouponControllerCreateResponse500>
     */
    SDK.prototype.couponController_create = function (body) {
        return this.core.fetch('/api/v1/coupons', 'post', body);
    };
    /**
     * Returns a coupon
     *
     * @summary Get a coupon
     * @throws FetchError<500, types.CouponControllerGetResponse500>
     */
    SDK.prototype.couponController_get = function (metadata) {
        return this.core.fetch('/api/v1/coupons/{id}', 'get', metadata);
    };
    /**
     * Updates a coupon
     *
     * @summary Update a coupon
     * @throws FetchError<500, types.CouponControllerUpdateResponse500>
     */
    SDK.prototype.couponController_update = function (body, metadata) {
        return this.core.fetch('/api/v1/coupons/{id}', 'put', body, metadata);
    };
    /**
     * Enable a coupon
     *
     * @summary Enable a coupon
     * @throws FetchError<500, types.CouponControllerEnableResponse500>
     */
    SDK.prototype.couponController_enable = function (metadata) {
        return this.core.fetch('/api/v1/coupons/{id}/enable', 'post', metadata);
    };
    /**
     * Disable a coupon
     *
     * @summary Disable a coupon
     * @throws FetchError<500, types.CouponControllerDisableResponse500>
     */
    SDK.prototype.couponController_disable = function (metadata) {
        return this.core.fetch('/api/v1/coupons/{id}/disable', 'post', metadata);
    };
    /**
     * Archive a coupon
     *
     * @summary Archive a coupon
     * @throws FetchError<500, types.CouponControllerArchiveResponse500>
     */
    SDK.prototype.couponController_archive = function (metadata) {
        return this.core.fetch('/api/v1/coupons/{id}/archive', 'post', metadata);
    };
    /**
     * Creates a tax rate
     *
     * @summary Create a tax rate
     * @throws FetchError<500, types.TaxRateControllerCreateResponse500>
     */
    SDK.prototype.taxRateController_create = function (body) {
        return this.core.fetch('/api/v1/tax-rates', 'post', body);
    };
    /**
     * Returns the list of tax rates
     *
     * @summary List of tax rates
     * @throws FetchError<500, types.TaxRateControllerFindAllResponse500>
     */
    SDK.prototype.taxRateController_findAll = function (metadata) {
        return this.core.fetch('/api/v1/tax-rates', 'get', metadata);
    };
    /**
     * Returns a tax rate
     *
     * @summary Get a tax rate
     * @throws FetchError<500, types.TaxRateControllerGetResponse500>
     */
    SDK.prototype.taxRateController_get = function (metadata) {
        return this.core.fetch('/api/v1/tax-rates/{id}', 'get', metadata);
    };
    /**
     * Updates a tax rate
     *
     * @summary Update a tax rate
     * @throws FetchError<500, types.TaxRateControllerUpdateResponse500>
     */
    SDK.prototype.taxRateController_update = function (body, metadata) {
        return this.core.fetch('/api/v1/tax-rates/{id}', 'put', body, metadata);
    };
    /**
     * Activate a tax rate
     *
     * @summary Activate a tax rate
     * @throws FetchError<500, types.TaxRateControllerActivateResponse500>
     */
    SDK.prototype.taxRateController_activate = function (metadata) {
        return this.core.fetch('/api/v1/tax-rates/{id}/activate', 'put', metadata);
    };
    /**
     * Deactivate a tax rate
     *
     * @summary Deactivate a tax rate
     * @throws FetchError<500, types.TaxRateControllerDeactivateResponse500>
     */
    SDK.prototype.taxRateController_deactivate = function (metadata) {
        return this.core.fetch('/api/v1/tax-rates/{id}/deactivate', 'put', metadata);
    };
    /** @throws FetchError<500, types.ConstantsControllerGetPricesResponse500> */
    SDK.prototype.constantsController_getPrices = function (metadata) {
        return this.core.fetch('/api/v1/constants/prices', 'get', metadata);
    };
    /** @throws FetchError<500, types.WebhookEndpointControllerGetAllResponse500> */
    SDK.prototype.webhookEndpointController_getAll = function (metadata) {
        return this.core.fetch('/api/v1/webhook-endpoints', 'get', metadata);
    };
    /** @throws FetchError<500, types.WebhookEndpointControllerCreateResponse500> */
    SDK.prototype.webhookEndpointController_create = function (body) {
        return this.core.fetch('/api/v1/webhook-endpoints', 'post', body);
    };
    /** @throws FetchError<500, types.WebhookEndpointControllerGetResponse500> */
    SDK.prototype.webhookEndpointController_get = function (metadata) {
        return this.core.fetch('/api/v1/webhook-endpoints/{id}', 'get', metadata);
    };
    /** @throws FetchError<500, types.WebhookEndpointControllerUpdateResponse500> */
    SDK.prototype.webhookEndpointController_update = function (body, metadata) {
        return this.core.fetch('/api/v1/webhook-endpoints/{id}', 'put', body, metadata);
    };
    /** @throws FetchError<500, types.WebhookEndpointControllerDeleteResponse500> */
    SDK.prototype.webhookEndpointController_delete = function (metadata) {
        return this.core.fetch('/api/v1/webhook-endpoints/{id}', 'delete', metadata);
    };
    /** @throws FetchError<500, types.WebhookEndpointControllerRegenerateResponse500> */
    SDK.prototype.webhookEndpointController_regenerate = function (metadata) {
        return this.core.fetch('/api/v1/webhook-endpoints/{id}/regenerate', 'post', metadata);
    };
    /** @throws FetchError<500, types.WebhookEndpointControllerTestResponse500> */
    SDK.prototype.webhookEndpointController_test = function (metadata) {
        return this.core.fetch('/api/v1/webhook-endpoints/{id}/test', 'post', metadata);
    };
    /**
     * partner_api
     *
     * @summary Create an account for a partner
     * @throws FetchError<500, types.PartnerControllerCreateAccountResponse500>
     */
    SDK.prototype.partnerController_createAccount = function (body) {
        return this.core.fetch('/api/v1/partners/accounts/onboard', 'post', body);
    };
    /**
     * partner_api
     *
     * @summary Get accounts of a partner by emails
     * @throws FetchError<500, types.PartnerControllerGetAccountResponse500>
     */
    SDK.prototype.partnerController_getAccount = function (metadata) {
        return this.core.fetch('/api/v1/partners/accounts', 'get', metadata);
    };
    return SDK;
}());
var createSDK = (function () { return new SDK(); })();
module.exports = createSDK;
