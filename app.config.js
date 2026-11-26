const appJson = require('./app.json');

const GOOGLE_CLIENT_ID_SUFFIX = '.apps.googleusercontent.com';

function googleAndroidOAuthScheme(clientId) {
  if (!clientId || !clientId.endsWith(GOOGLE_CLIENT_ID_SUFFIX)) return null;
  const prefix = clientId.slice(0, -GOOGLE_CLIENT_ID_SUFFIX.length);
  return prefix ? `com.googleusercontent.apps.${prefix}` : null;
}

const expo = { ...appJson.expo };
const googleScheme = googleAndroidOAuthScheme(process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID);
const schemes = [
  ...(Array.isArray(expo.scheme) ? expo.scheme : expo.scheme ? [expo.scheme] : []),
];
if (googleScheme && !schemes.includes(googleScheme)) {
  schemes.push(googleScheme);
}
if (process.env.EAS_BUILD === 'true' && process.env.EAS_BUILD_PLATFORM === 'android' && !googleScheme) {
  throw new Error(
    'Missing EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID; cannot register the Google Android OAuth redirect scheme.'
  );
}
expo.scheme = schemes;

module.exports = { expo };
