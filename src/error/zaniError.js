/** Error class for ZaniJS system.
 * 
 * @author Brock Kitterman <brock.kitterman@gmail.com>
 */
export default class ZaniError extends Error {
    /** Create a new ZaniError object.
     * 
     * @param {string} message - Message of the error
     * @param {object} errorInfo - The information of the error object.
     * @param {string} [errorInfo.code] - The code of the error
     * @param {number} [errorInfo.statusCode] - The HTTP code of the error
     * @param {string} [errorInfo.context] - The context of the error
     * @param {string} [errorInfo.cause] - The cause of the error
     */
    constructor(message, { code, statusCode, context, cause } = {}) {
        super(message);
        this.name = this.constructor.name;
        this.code = code;
        this.statusCode = statusCode;
        this.context = context;
        this.cause = cause;
        this.timestamp = new Date();
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }

    /** Convert the error to a JSON and return.
     * 
     * @returns {object} - The error as a JSON
     */
    toJSON() {
        return {
            name: this.name,
            message: this.message,
            code: this.code,
            statusCode: this.statusCode,
            context: this.context,
            timestamp: this.timestamp,
            stack: this.stack,
            cause: this.cause ? this.cause.toString() : undefined,
        };
    }
}