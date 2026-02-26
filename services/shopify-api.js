// Shopify API helper with GraphQL (works in dev mode)

// Helper: Sleep function
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class ShopifyAPIService {
  /**
   * Fetch orders from Shopify using GraphQL
   * @param {Object} session - Shopify session with shop and accessToken
   * @param {Object} options - Fetch options
   * @returns {Array} - Array of orders
   */
  static async fetchOrders(session, options = {}) {
    const {
      limit = 250, // Max per request
      created_at_min = null,
      max_pages = 10, // Safety limit
    } = options;

    console.log('📦 Fetching orders from Shopify (GraphQL)...');
    console.log('   Shop:', session.shop);
    console.log('   Limit per page:', limit);
    if (created_at_min) {
      console.log('   Created after:', created_at_min);
    }

    let allOrders = [];
    let page = 1;
    let hasNextPage = true;
    let cursor = null;

    try {
      while (hasNextPage && page <= max_pages) {
        console.log(`   📄 Fetching page ${page}...`);

        // Build GraphQL query
        const query = this.buildOrdersQuery(limit, cursor, created_at_min);

        // Fetch orders with retry logic
        const response = await this.fetchWithRetry(async () => {
          const url = `https://${session.shop}/admin/api/2024-01/graphql.json`;
          
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              'X-Shopify-Access-Token': session.accessToken,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query }),
          });

          if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`Shopify GraphQL error: ${res.status} ${res.statusText} - ${errorText}`);
          }

          return await res.json();
        });

        // Check for GraphQL errors
        if (response.errors) {
          throw new Error(`GraphQL errors: ${JSON.stringify(response.errors)}`);
        }

        const ordersData = response.data?.orders;
        if (!ordersData) {
          throw new Error('No orders data in response');
        }

        const orders = ordersData.edges.map(edge => this.transformGraphQLOrder(edge.node));
        allOrders.push(...orders);

        console.log(`   ✅ Page ${page}: ${orders.length} orders`);

        // Check for next page
        hasNextPage = ordersData.pageInfo.hasNextPage;
        
        if (hasNextPage && ordersData.edges.length > 0) {
          cursor = ordersData.edges[ordersData.edges.length - 1].cursor;
        }

        page++;

        // Rate limit: Wait 500ms between requests
        if (hasNextPage) {
          await sleep(500);
        }
      }

      console.log(`✅ Total orders fetched: ${allOrders.length}`);
      return allOrders;

    } catch (error) {
      console.error('❌ Error fetching orders:', error);
      throw error;
    }
  }

  /**
   * Build GraphQL query for orders
   */
  static buildOrdersQuery(limit, cursor, createdAtMin) {
    const afterClause = cursor ? `, after: "${cursor}"` : '';
    const queryFilter = createdAtMin ? `, query: "created_at:>='${createdAtMin}'"` : '';

    return `
      query {
        orders(first: ${limit}${afterClause}${queryFilter}) {
          edges {
            cursor
            node {
              id
              name
              createdAt
              totalPriceSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              lineItems(first: 250) {
                edges {
                  node {
                    id
                    title
                    quantity
                    originalUnitPriceSet {
                      shopMoney {
                        amount
                      }
                    }
                    product {
                      id
                    }
                    variant {
                      id
                    }
                    customAttributes {
                      key
                      value
                    }
                  }
                }
              }
            }
          }
          pageInfo {
            hasNextPage
          }
        }
      }
    `;
  }

  /**
   * Transform GraphQL order to REST-like format
   */
  static transformGraphQLOrder(node) {
    return {
      id: node.id.split('/').pop(), // Extract numeric ID
      name: node.name,
      order_number: node.name,
      created_at: node.createdAt,
      total_price: node.totalPriceSet.shopMoney.amount,
      currency: node.totalPriceSet.shopMoney.currencyCode,
      line_items: node.lineItems.edges.map(edge => ({
        id: edge.node.id.split('/').pop(),
        title: edge.node.title,
        quantity: edge.node.quantity,
        price: edge.node.originalUnitPriceSet.shopMoney.amount,
        product_id: edge.node.product?.id.split('/').pop() || null,
        variant_id: edge.node.variant?.id.split('/').pop() || null,
        properties: edge.node.customAttributes.map(attr => ({
          name: attr.key,
          value: attr.value,
        })),
      })),
    };
  }

  /**
   * Fetch with retry logic for rate limiting
   * @param {Function} fetchFunction - Function to execute
   * @param {Number} maxRetries - Max retry attempts
   * @returns {Promise} - Response
   */
  static async fetchWithRetry(fetchFunction, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fetchFunction();
      } catch (error) {
        // Check if rate limited (429)
        if (error.message.includes('429')) {
          const retryAfter = 2; // Default 2 seconds
          console.log(`⏳ Rate limited. Waiting ${retryAfter}s... (Attempt ${attempt}/${maxRetries})`);
          
          if (attempt < maxRetries) {
            await sleep(retryAfter * 1000);
            continue;
          }
        }
        
        // If not rate limit or max retries exceeded, throw error
        throw error;
      }
    }
  }

  /**
   * Filter orders that have See Before Buy items
   * @param {Array} orders - Array of orders
   * @returns {Array} - Filtered orders with SBB items
   */
  static filterSBBOrders(orders) {
    console.log('🔍 Filtering orders with SBB items...');
    
    const sbbOrders = orders.filter(order => {
      return order.line_items?.some(item => {
        return item.properties?.some(prop => 
          prop.name === '_sbb_try_on' && prop.value === 'true'
        );
      });
    });

    console.log(`   ✅ Found ${sbbOrders.length} orders with SBB items`);
    return sbbOrders;
  }

  /**
   * Extract session IDs from order
   * @param {Object} order - Shopify order
   * @returns {Array} - Array of session IDs
   */
  static extractSessionIds(order) {
    const sessionIds = [];
    
    order.line_items?.forEach(item => {
      item.properties?.forEach(prop => {
        if (prop.name === '_sbb_session_id' && prop.value) {
          sessionIds.push(prop.value);
        }
      });
    });

    return [...new Set(sessionIds)]; // Remove duplicates
  }
}

module.exports = ShopifyAPIService;
