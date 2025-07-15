import ZaniError from './zaniError.js';

/** An error thrown when a required parameter is missing from a method. 
 * 
 * Note: This is called on the first missing parameter only, and does not indicate more than 1 missing.
 * 
 * @extends ZaniError
 *
 * @author Brock Kitterman <brock.kitterman@gmail.com>
 */
export default class MissingParametersError extends ZaniError {
	/** Create a new instance of the MissingParametersError class.
	 *
	 * @example
	 * throw new MissingParametersError('user', 'getId');
	 *
	 * @param {string} param - The missing parameter
     * @param {string} method - The method called
	 */
	constructor(param, method) {
		super(`Missing parameter ${param} in method ${method}.`, {
			code: 'ZANI_E_MISSING_PARAMETER',
			statusCode: 400,
			context: { param: param, method: method },
		});
	}
}
