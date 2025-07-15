import ZaniError from "./zaniError.js";

/** An error thrown when an operation requiring a collection does not receive a collection as a parameter.
 *
 * @extends ZaniError
 *
 * @author Brock Kitterman <brock.kitterman@gmail.com>
 */
export default class NoCollectionError extends ZaniError {
	/** Create a new instance of the NoCollectionError class.
	 *
	 * @example
	 * throw new NoCollectionError('get');
	 *
	 * @param {string} operation - The operation attempted
	 */
	constructor(operation) {
		super(`No collection provided.`, {
			code: 'ZANI_E_NO_COLLECTION',
			statusCode: 400,
			context: { operation: operation },
		});
	}
}
