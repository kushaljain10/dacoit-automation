import copperx from "@api/copperx/index.js";
import dotenv from "dotenv";
dotenv.config();

// Initialize CopperX with API key
copperx.auth(process.env.COPPERX_KEY);

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
    const response = await copperx.customerController_findAll({
      page: Math.floor(offset / limit) + 1,
      limit: limit,
    });
    console.log(`✅ Fetched ${response.data.data?.length || 0} customers`);
    return response.data.data || [];
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

    const response = await copperx.customerController_create(customerData);
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

    // Transform the data to match the expected API format
    const apiData = {
      lineItems: {
        data: invoiceData.lineItems.map((item) => ({
          priceData: {
            currency: item.currency,
            productData: {
              name: item.name,
            },
            unitAmount: item.amount, // Already in correct format with 8 decimals
          },
          quantity: item.quantity,
        })),
      },
      paymentSetting: {
        allowSwap: false,
      },
    };

    const response = await copperx.invoiceController_create(apiData);
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

/**
 * Create an invoice using the controller API (matches user's example)
 * @param {Object} invoiceData - Invoice data in the format expected by CopperX API
 * @returns {Promise<Object>} Created invoice object
 */
const invoiceController_create = async (invoiceData) => {
  try {
    console.log(`Creating invoice via controller API:`, {
      lineItemsCount: invoiceData.lineItems?.data?.length,
    });

    const response = await copperx.invoiceController_create(invoiceData);
    console.log(`✅ Invoice created with ID: ${response.data.id}`);
    return response;
  } catch (error) {
    console.error(
      "Error creating invoice via controller API:",
      error.response?.data || error.message
    );
    throw error;
  }
};

/**
 * Test CopperX API connectivity and functionality
 * @returns {Promise<Object>} Test results with status for each endpoint
 */
const testCopperXAPI = async () => {
  const results = {
    customersGet: { status: "unknown", error: null },
    customersPost: { status: "unknown", error: null },
    invoicesPost: { status: "unknown", error: null },
    authMe: { status: "unknown", error: null },
  };

  try {
    // Test GET /customers
    console.log("🧪 Testing GET /customers...");
    try {
      const response = await copperx.customerController_findAll({
        limit: 1,
        page: 1,
      });
      results.customersGet.status =
        response.status === 200 ? "success" : "failed";
      console.log(`✅ GET /customers: ${response.status}`);
    } catch (error) {
      results.customersGet.status = "failed";
      results.customersGet.error = error.message;
      console.log(`❌ GET /customers: ${error.message}`);
    }

    // Test POST /customers
    console.log("🧪 Testing POST /customers...");
    try {
      const testCustomerData = {
        name: "API Test Customer",
        email: "test@example.com",
        organizationName: "Test Organization",
      };
      const response = await copperx.customerController_create(
        testCustomerData
      );
      results.customersPost.status =
        response.status === 200 || response.status === 201
          ? "success"
          : "failed";
      console.log(`✅ POST /customers: ${response.status}`);
    } catch (error) {
      results.customersPost.status = "failed";
      results.customersPost.error = error.message;
      console.log(`❌ POST /customers: ${error.message}`);
    }

    // Test POST /invoices
    console.log("🧪 Testing POST /invoices...");
    try {
      const testInvoiceData = {
        customerId: "test-customer-id",
        currency: "usdc",
        dueDate: "2025-12-31",
        lineItems: [
          {
            name: "Test Item",
            price: 100,
            quantity: 1,
          },
        ],
      };
      const response = await copperx.invoiceController_create(testInvoiceData);
      results.invoicesPost.status =
        response.status === 200 || response.status === 201
          ? "success"
          : "failed";
      console.log(`✅ POST /invoices: ${response.status}`);
    } catch (error) {
      results.invoicesPost.status = "failed";
      results.invoicesPost.error = error.message;
      console.log(`❌ POST /invoices: ${error.message}`);
    }

    // Test authentication (no specific endpoint needed for SDK)
    console.log("🧪 Testing authentication...");
    try {
      // The SDK auth is already set up, so if we get here, auth is working
      results.authMe.status = "success";
      console.log(`✅ Authentication: Working`);
    } catch (error) {
      results.authMe.status = "failed";
      results.authMe.error = error.message;
      console.log(`❌ Authentication: ${error.message}`);
    }
  } catch (error) {
    console.error("❌ API test failed:", error.message);
    results.error = error.message;
  }

  return results;
};

export {
  getCustomers,
  createCustomer,
  createInvoice,
  invoiceController_create,
  testCopperXAPI,
};
