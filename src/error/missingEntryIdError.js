import ZaniError from './zaniError.js';

/** An error thrown when a attempting an operation that requires a passed object has a '_id' value,
 * but has no said value.
 *
 * @extends ZaniError
 *
 * @author Brock Kitterman <brock.kitterman@gmail.com>
 */
export default class MissingEntryIdError extends ZaniError {
	/** Create a new instance of the MissingEntryIdError class.
	 *
	 * @example
	 * throw new MissingEntryIdError('update');
	 *
	 * @param {string} operation - The operation attempted
	 */
	constructor(operation) {
		super(`The object entry/update/similar object passed in method ${operation} has no _id value.`, {
			code: 'ZANI_E_MISSING_ENTRY_ID',
			statusCode: 400,
			context: { operation: operation },
		});
	}
}
