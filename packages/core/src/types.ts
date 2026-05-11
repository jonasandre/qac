export type ApiKeyCredentials = {
  type: 'api-key';
  apiKey: string;
};

export type OAuthM2MCredentials = {
  type: 'oauth-m2m';
  clientId: string;
  clientSecret: string;
};

export type Credentials = ApiKeyCredentials | OAuthM2MCredentials;

export type QlikContext = {
  name: string;
  tenant: string;
  credentials: Credentials;
};

export type ContextSummary = {
  name: string;
  tenant: string;
  authType: Credentials['type'];
  active: boolean;
};
