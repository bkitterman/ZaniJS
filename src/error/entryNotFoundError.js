const ZaniError = require('./zaniError');

/** An error thrown when a an entry cannot be located within a collection.
 *
 * @extends ZaniError
 *
 * @author Brock Kitterman <brock.kitterman@gmail.com>
 */
class EntryNotFoundError extends ZaniError {
	/** Create a new instance of the EntryNotFoundError class.
	 *
	 * @example
	 * throw new EntryNotFoundError('users', 1, 'update');
	 *
     * @param {string} collection - The name of the collection
     * @param {number} id - The id of the entry
	 * @param {string} operation - The operation attempted
	 */
	constructor(collection, id, operation) {
		super(`The entry ${id} in collection ${collection} cannot be found.`, {
			code: 'ZANI_E_ENTRY_NOT_FOUND',
			statusCode: 404,
			context: { collection: collection, id: id, operation: operation },
		});
	}
}

module.exports = EntryNotFoundError;
