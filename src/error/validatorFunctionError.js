const ZaniError = require('./zaniError');

/** An error thrown as a result of a error in a validator function in collection entry validation. 
 *
 * @extends ZaniError
 *
 * @author Brock Kitterman <brock.kitterman@gmail.com>
 */
class ValidatorFunctionError extends ZaniError {
	/** Create a new instance of the ValidatorFunctionError class.
	 *
	 * @example
	 * throw new ValidatorFunctionError('users', 'email', err);
	 *
	 * @param {string} collection - The name of the collection
     * @param {string} attribute - The attribute name
	 * @param {error} err - The thrown error from the function
	 */
	constructor(collection, attribute, err) {
		super(`Validator function error for attribute ${attribute} in collection ${collection} ` +
            `has thrown an error. \n\n ${err.message}`, {
			code: 'ZANI_E_VALIDATOR_FUNCTION_FAILURE',
			statusCode: 500,
			context: { operation: operation, collection: collection },
		});
		this.collectionName = collectionName;
	}
}

module.exports = ValidatorFunctionError;
