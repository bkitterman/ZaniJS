const ZaniError = require('./zaniError');

/** An error thrown when attempting to delete the current active database.
 * 
 * @extends ZaniError
 *
 * @author Brock Kitterman <brock.kitterman@gmail.com>
 */
class DeleteActiveDatabaseError extends ZaniError {
	/** Create a new instance of the DeleteActiveDatabaseError class.
	 *
	 * @example
	 * throw new DeleteActiveDatabaseError('dataCentre'');
	 *
	 * @param {string} databaseName - The database name
	 */
	constructor(database) {
		super(`Cannot delete currently active database ${database}. Please set a different database.`, {
			code: 'ZANI_E_DELETE_ACTIVE_DATABASE',
			statusCode: 403,
			context: { database: database },
		});
	}
}

module.exports = DeleteActiveDatabaseError;
