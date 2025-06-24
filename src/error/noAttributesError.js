const ZaniError = require('./zaniError');

/** An error thrown when a attempting an operation on an entry or entry-aligned object, but said
 * object has no provided attributes.
 *
 * @extends ZaniError
 *
 * @author Brock Kitterman <brock.kitterman@gmail.com>
 */
class NoAttributesError extends ZaniError {
	/** Create a new instance of the NoAttributesError class.
	 *
	 * @example
	 * throw new NoAttributesError('update');
	 *
	 * @param {string} operation - The operation attempted
	 */
	constructor(operation) {
		super(`The object entry/update/similar object passed in method ${operation} has no attributes.`, {
			code: 'ZANI_E_NO_ATTRIBUTES',
			statusCode: 400,
			context: { operation: operation },
		});
	}
}

module.exports = NoAttributesError;
