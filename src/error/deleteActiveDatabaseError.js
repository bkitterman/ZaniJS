import ZaniError from './zaniError.js';

/** An error thrown when attempting to delete the current active database.
 * 
 * @extends ZaniError
 *
 * @author Brock Kitterman <brock.kitterman@gmail.com>
 */
export default class DeleteActiveDatabaseError extends ZaniError {
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
