import ZaniError from './zaniError.js';

/** An error thrown when an operation requiring a collection is unable to locate the provided collection.
 *
 * @extends ZaniError
 *
 * @author Brock Kitterman <brock.kitterman@gmail.com>
 */
export default class CollectionNotFoundError extends ZaniError {
	/** Create a new instance of the CollectionNotFoundError class.
	 *
	 * @example
	 * throw new CollectionNotFoundError('users', 'get');
	 *
	 * @param {string} collection - The name of the collection
	 * @param {string} operation - The operation attempted
	 */
	constructor(collection, operation) {
		super(`Collection "${collection}" cannot be located.`, {
			code: 'ZANI_E_COLLECTION_NOT_FOUND',
			statusCode: 404,
			context: { operation: operation, collection: collection },
		});
		this.collection = collection;
	}
}
