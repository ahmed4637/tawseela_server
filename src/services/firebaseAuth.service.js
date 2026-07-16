const fs = require('fs');
const path = require('path');

let firebaseAuthClient = null;
let firebaseAuthInitError = null;

const readServiceAccount = () => {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    const serviceAccountPath = path.resolve(
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH
    );

    if (!fs.existsSync(serviceAccountPath)) {
      throw new Error(
        `Firebase service account file not found: ${serviceAccountPath}`
      );
    }

    return JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }

  if (
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY
  ) {
    return {
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    };
  }

  return null;
};

const getFirebaseAuth = () => {
  if (firebaseAuthClient) {
    return firebaseAuthClient;
  }

  if (firebaseAuthInitError) {
    throw firebaseAuthInitError;
  }

  try {
    // firebase-admin v14 modular API.
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    const { cert, getApps, initializeApp } = require('firebase-admin/app');
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    const { getAuth } = require('firebase-admin/auth');

    let apps = getApps();

    if (apps.length === 0) {
      const serviceAccount = readServiceAccount();

      if (!serviceAccount) {
        throw new Error('Firebase credentials are not configured');
      }

      initializeApp({
        credential: cert(serviceAccount),
        projectId:
          process.env.FIREBASE_PROJECT_ID ||
          serviceAccount.project_id ||
          serviceAccount.projectId ||
          undefined,
      });

      apps = getApps();
    }

    firebaseAuthClient = getAuth(apps[0]);
    return firebaseAuthClient;
  } catch (error) {
    firebaseAuthInitError = error;
    throw error;
  }
};

module.exports = {
  getFirebaseAuth,
};
