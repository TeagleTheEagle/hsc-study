export class APIError extends Error { constructor(s, m) { super(m || 'api'); this.status = s; } }
export class BadRequestError extends APIError {} export class RateLimitError extends APIError {} export class APIConnectionTimeoutError extends Error {}
export default class Anthropic { constructor(o) { this.opts = o; } static APIError = APIError; static BadRequestError = BadRequestError; static RateLimitError = RateLimitError; static APIConnectionTimeoutError = APIConnectionTimeoutError;
  get beta() { return { messages: { create: async req => globalThis.__claude(req) } }; } get messages() { return { create: async req => globalThis.__claude(req) }; } }
