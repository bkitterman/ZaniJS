import ZaniError from './zaniError.js';

/** An error thrown when attempting to create a new collection but it already is within the system.
 * 
 * @extends ZaniError
 *
 * @author Brock Kitterman <brock.kitterman@gmail.com>
 */
export default class CollectionAlreadyExistsError extends ZaniError {
	/** Create a new instance of the CollectionAlreadyExistsError class.
	 *
	 * @example
	 * throw new CollectionAlreadyExistsError('users');
	 *
	 * @param {string} collection - The name of the collection
	 */
	constructor(collection, databaseName) {
		super(`Collection "${collection}" already exists.`, {
			code: 'ZANI_E_COLLECTION_ALREADY_EXISTS',
			statusCode: 409,
			context: { operation: 'create', collection: collection },
		});
		this.databaseName = databaseName | null;
	}
}
