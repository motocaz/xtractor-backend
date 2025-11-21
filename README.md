# Xtractor Backend - Polar SDK Integration

This project is a backend service built with Express.js that integrates the [Polar SDK](https://polar.sh/) for payments and subscriptions, and [Clerk](https://clerk.com/) for user authentication.

## Features

- **Polar Webhook Handling**: Securely listens for Polar webhook events (e.g., `subscription.active`) to sync subscription status with user accounts.
- **Checkout Session Creation**: Generates Polar checkout links for users, automatically linking the purchase to their Clerk user profile via metadata.
- **Clerk Authentication**: Protects endpoints using Clerk middleware to ensure only authenticated users can initiate checkouts.
- **CORS Support**: Configured to allow requests from a specified frontend URL.

## Prerequisites

- Node.js (v18 or higher recommended)
- npm or yarn
- A [Polar](https://polar.sh/) account
- A [Clerk](https://clerk.com/) account

## Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd polar-js-sdk
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

## Configuration

Create a `.env` file in the root directory and configure the following environment variables:

```env
# Server Configuration
PORT=3000
FRONTEND_URL=http://localhost:5173 # URL of your frontend application

# Clerk Authentication
CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...

# Polar SDK Configuration
POLAR_ACCESS_TOKEN=polar_at_...
POLAR_WEBHOOK_SECRET=polar_wh_...
POLAR_SERVER=sandbox # or 'production'
```

## Usage

Start the server:

```bash
node index.js
```

The server will start on the port specified in your `.env` file (default: 3000).

## API Endpoints

### 1. Webhook Handler
- **URL**: `/webhook`
- **Method**: `POST`
- **Description**: Receives and verifies webhook events from Polar.
- **Supported Events**:
  - `subscription.active`: Updates the corresponding Clerk user's metadata with subscription details (`subscriptionId`, `customerId`, `plan`, `status`).

### 2. Create Checkout
- **URL**: `/create-checkout`
- **Method**: `POST`
- **Auth**: Required (Clerk Bearer Token)
- **Body**: JSON object containing checkout options (passed directly to `polar.checkouts.create`).
- **Description**: Creates a checkout session. It automatically injects the authenticated user's Clerk ID into the `customerMetadata` to track the purchase.

### 3. Test Authentication
- **URL**: `/test-auth`
- **Method**: `GET`
- **Auth**: Required (Clerk Bearer Token)
- **Description**: Returns the authenticated user's ID if the token is valid.

## Project Structure

- `index.js`: Main entry point containing all route logic and configuration.
- `.env`: Environment variables (not committed to version control).
