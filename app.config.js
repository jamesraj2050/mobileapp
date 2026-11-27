const GOOGLE_CLIENT_ID_SUFFIX = '.apps.googleusercontent.com';

function reversedGoogleClientScheme(clientId) {
  if (!clientId || !clientId.endsWith(GOOGLE_CLIENT_ID_SUFFIX)) return null;
  const prefix = clientId.slice(0, -GOOGLE_CLIENT_ID_SUFFIX.length);
  return prefix ? `com.googleusercontent.apps.${prefix}` : null;
}

module.exports = ({ config }) => {
  const iosUrlScheme = reversedGoogleClientScheme(process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID);

  if (process.env.EAS_BUILD === 'true' && !iosUrlScheme) {
    throw new Error(
      'Missing EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID; cannot configure native Google Sign-In.'
    );
  }

  if (!iosUrlScheme) return config;

  return {
    ...config,
    plugins: [
      ...(config.plugins ?? []),
      [
        'react-native-nitro-google-signin',
        {
          iosUrlScheme,
        },
      ],
    ],
  };
};
