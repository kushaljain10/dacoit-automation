const axios = require("axios");
require("dotenv").config();

const COPPERX_API_KEY = process.env.COPPERX_KEY;
const COPPERX_BASE_URL = "https://api.copperx.dev";

const copperxApi = axios.create({
  baseURL: COPPERX_BASE_URL,
  headers: {
    "api-key": COPPERX_API_KEY,
    "Content-Type": "application/json",
  },
});

/**
 * Get list of customers with pagination
 * @param {Object} params - Query parameters
 * @param {number} params.limit - Number of customers to return (default: 10)
 * @param {number} params.offset - Offset for pagination (default: 0)
 * @returns {Promise<Object>} Response with customers data and metadata
 */
const getCustomers = async ({ limit = 10, offset = 0 } = {}) => {
  try {
    console.log(
      `Fetching customers from CopperX (limit: ${limit}, offset: ${offset})`
    );
    const response = await copperxApi.get("/customers", {
      params: { limit, offset },
    });
    console.log(`✅ Fetched ${response.data.data?.length || 0} customers`);
    return response.data;
  } catch (error) {
    console.error(
      "Error fetching customers from CopperX:",
      error.response?.data || error.message
    );
    throw error;
  }
};

/**
 * Create a new customer
 * @param {Object} customerData - Customer data
 * @param {string} customerData.name - Customer name (required)
 * @param {string} customerData.email - Customer email (required)
 * @param {string} customerData.organizationName - Organization name (required)
 * @returns {Promise<Object>} Created customer object
 */
const createCustomer = async (customerData) => {
  try {
    console.log(`Creating customer in CopperX:`, {
      name: customerData.name,
      email: customerData.email,
      organizationName: customerData.organizationName,
    });

    const response = await copperxApi.post("/customers", customerData);
    console.log(`✅ Customer created with ID: ${response.data.id}`);
    return response.data;
  } catch (error) {
    console.error(
      "Error creating customer in CopperX:",
      error.response?.data || error.message
    );
    throw error;
  }
};

/**
 * Create an invoice
 * @param {Object} invoiceData - Invoice data
 * @param {string} invoiceData.customerId - Customer ID (required)
 * @param {string} invoiceData.currency - Currency code (required)
 * @param {string} invoiceData.dueDate - Due date in YYYY-MM-DD format (required)
 * @param {Array} invoiceData.lineItems - Array of line items (required)
 * @param {string} invoiceData.lineItems[].name - Item name
 * @param {number} invoiceData.lineItems[].price - Item price
 * @returns {Promise<Object>} Created invoice object
 */
const createInvoice = async (invoiceData) => {
  try {
    console.log(`Creating invoice in CopperX:`, {
      customerId: invoiceData.customerId,
      currency: invoiceData.currency,
      dueDate: invoiceData.dueDate,
      lineItemsCount: invoiceData.lineItems?.length,
    });

    const response = await copperxApi.post("/invoices", invoiceData);
    console.log(`✅ Invoice created with ID: ${response.data.id}`);
    return response.data;
  } catch (error) {
    console.error(
      "Error creating invoice in CopperX:",
      error.response?.data || error.message
    );
    throw error;
  }
};

module.exports = {
  getCustomers,
  createCustomer,
  createInvoice,
};
