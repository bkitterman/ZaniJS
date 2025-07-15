import ZaniError from "./zaniError.js";

/** An error thrown when an operation requiring a active database is run without a active 
 * database selected or in use.
 * 
 * @extends ZaniError
 *
 * @author Brock Kitterman <brock.kitterman@gmail.com>
 */
export default class NoActiveDatabaseError extends ZaniError {
	/** Create a new instance of the NoActiveDatabaseError class.
	 *
	 * @example
	 * throw new NoActiveDatabaseError('get');
	 *
	 * @param {string} operation - The operation attempted
	 */
	constructor(operation) {
		super(`No active database provided. Please set one using Zani.setDatabase()`, {
			code: 'ZANI_E_NO_ACTIVE_DATABASE',
			statusCode: 404,
			context: { operation: operation },
		});
	}
}
