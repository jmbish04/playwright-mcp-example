// Minimal shim for 'cloudflare:email' in unit tests
export const mailer = {
  send: async (_msg: any) => ({ id: 'test-email-id' }),
};
export default mailer as any;

