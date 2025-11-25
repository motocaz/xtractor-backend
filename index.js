const express = require("express");
const serverless = require("serverless-http");
const { validateEvent, WebhookVerificationError } = require("@polar-sh/sdk/webhooks");
const cors = require("cors");
const { Polar } = require("@polar-sh/sdk");
const { clerkMiddleware, getAuth, createClerkClient } = require("@clerk/express");

if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

const app = express();
const port = process.env.PORT || 3000;

app.use(
  cors({
    origin: process.env.FRONTEND_URL,
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
  publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
});

app.use(
  clerkMiddleware({
    publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
    secretKey: process.env.CLERK_SECRET_KEY,
  })
);

const polar = new Polar({
  accessToken: process.env.POLAR_ACCESS_TOKEN,
  server: process.env.POLAR_SERVER,
});

app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    const event = validateEvent(req.body, req.headers, process.env.POLAR_WEBHOOK_SECRET);

    console.log(`Received event: ${event.type}`);

    if (event.type === "subscription.active") {
      const subscription = event.data;
      const checkoutId = subscription.checkoutId;

      if (checkoutId) {
        console.log(`Fetching checkout data for ID: ${checkoutId}...`);

        const checkout = await polar.checkouts.get({ id: checkoutId });
        const clerkUserId = checkout.customerMetadata?.clerk_user_id;

        if (clerkUserId) {
          console.log(`✅ Verified User! Linking Subscription ${subscription.id} to Clerk User ${clerkUserId}`);

          await clerkClient.users.updateUserMetadata(clerkUserId, {
            publicMetadata: {
              subscriptionId: subscription.id,
              customerId: subscription.customerId,
              plan: "pro",
              status: "active",
            },
          });

          console.log("Clerk user metadata updated successfully.");
        } else {
          console.error("❌ No clerk_user_id found in checkout metadata.");
        }
      }
    }

    if (event.type === "subscription.revoked") {
      const subscription = event.data;
      const checkoutId = subscription.checkoutId;

      if (checkoutId) {
        console.log(`Fetching checkout data for ID: ${checkoutId}...`);

        const checkout = await polar.checkouts.get({ id: checkoutId });
        const clerkUserId = checkout.customerMetadata?.clerk_user_id;

        if (clerkUserId) {
          console.log(`✅ Verified User! Updating Subscription ${subscription.id} for Clerk User ${clerkUserId}`);

          const user = await clerkClient.users.getUser(clerkUserId);
          const currentMetadata = user.publicMetadata || {};

          await clerkClient.users.updateUserMetadata(clerkUserId, {
            publicMetadata: {
              ...currentMetadata,
              subscriptionId: currentMetadata.subscriptionId || subscription.id,
              customerId: subscription.customerId,
              plan: "free",
              status: "revoked",
            },
          });

          console.log("Clerk user metadata updated successfully.");
        } else {
          console.error("❌ No clerk_user_id found in checkout metadata.");
        }
      } else {
        console.error("❌ No checkoutId found in subscription data.");
      }
    }


    res.status(202).send("");
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      console.error("Webhook verification failed:", error);
      res.status(403).send("");
    } else {
      console.error("Webhook processing error:", error);
      res.status(500).send("Internal Server Error");
    }
  }
});

app.get("/test-auth", (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized: No userId found" });
  }
  res.json({ userId });
});

app.get("/api/create-portal-session", async (req, res) => {
  try {
    const { userId } = getAuth(req);

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized: No userId found" });
    }

    const user = await clerkClient.users.getUser(userId);
    const polarCustomerId = user.publicMetadata?.customerId;

    if (!polarCustomerId) {
      return res.status(404).json({ error: "No active subscription found for this user." });
    }

    const session = await polar.customerSessions.create({
      customerId: polarCustomerId,
    });

    res.json({ url: session.customerPortalUrl });
  } catch (error) {
    console.error("Polar Error:", error);
    res.status(500).send("Failed to generate portal session");
  }
});

app.post("/create-checkout", express.json(), async (req, res) => {
  if (!req.body || Object.keys(req.body).length === 0) {
    return res.status(400).json({ error: "Request body is missing or empty" });
  }

  const { userId } = getAuth(req);

  if (!userId) {
    return res.status(401).json({ error: "Unauthorized: No userId found" });
  }

  try {
    const checkoutOptions = {
      ...req.body,
      successUrl: `${process.env.FRONTEND_URL}/?payment=success&checkout_id={CHECKOUT_ID}`,
      customerMetadata: {
        ...(req.body.customerMetadata || req.body.customer_metadata || {}),
        clerk_user_id: userId,
      },
    };

    delete checkoutOptions.customer_metadata;

    const result = await polar.checkouts.create(checkoutOptions);

    if (result.customerMetadata?.clerk_user_id === userId) {
      console.log(`Checkout created successfully for Clerk User: ${userId}`);
      res.json(result);
    } else {
      console.warn("Checkout created, but metadata verification failed.");
      console.log("Result Metadata:", result.customerMetadata);
      res.status(201).json(result);
    }
  } catch (error) {
    console.error("Error creating checkout session:", error);
    if (error.name === "SDKValidationError") {
      res.status(422).json({ error: "Input validation failed", details: error.message });
    } else {
      res.status(500).json({ error: "Failed to create checkout session" });
    }
  }
});

app.get("/api/products", async (req, res) => {
  try {
    console.log("Fetching products from Polar...");

    const response = await polar.products.list({
      isRecurring: true,
      isArchived: false,
    });

    const productsList = response.result?.items || [];
    console.log(`Found ${productsList.length} products.`);

    const formattedProducts = [];

    for (const item of productsList) {
      const priceData = item.prices && item.prices.length > 0 ? item.prices[0] : null;
      
      console.log(`Price structure for ${item.name}:`, JSON.stringify(priceData, null, 2));

      const rawAmount = priceData?.price_amount ?? priceData?.priceAmount ?? 0;
      const price = rawAmount / 100;

      const rawCurrency = priceData?.price_currency || priceData?.priceCurrency || "usd";
      const currency = rawCurrency.toUpperCase();

      const features = item.benefits ? item.benefits.map((benefit) => benefit.description) : [];

      const isPopular = item.name.toLowerCase().includes("pro");

      formattedProducts.push({
        id: item.id,
        name: item.name,
        description: item.description || "",
        price: price,
        currency: currency,
        features: features,
        popular: isPopular,
      });
    }

    res.json({
      products: formattedProducts,
    });
  } catch (error) {
    console.error("Erro ao processar produtos:", error);
    if (error.response) {
       console.error("Detalhes da resposta:", JSON.stringify(error.response, null, 2));
    }
    res.status(500).json({ error: "Falha ao carregar os produtos." });
  }
});

if (process.env.NODE_ENV !== "production") {
  app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });
}

module.exports.handler = serverless(app);