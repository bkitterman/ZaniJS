import ZaniError from './zaniError.js';

/** An error thrown when a attempting to index an attribute that has already been indexed.
 * 
 * @extends ZaniError
 *
 * @author Brock Kitterman <brock.kitterman@gmail.com>
 */
export default class AttributeAlreadyIndexedError extends ZaniError {
	/** Create a new instance of the AttributeAlreadyIndexedError class.
	 *
	 * @example
	 * throw new AttributeAlreadyIndexedError('username', 'users');
	 *
	 * @param {string} collection - The parent collection
     * @param {string} attribute - The attribute attempted to index
	 */
	constructor(collection, attribute) {
		super(`The attribute ${attribute} in collection ${collection} has already been indexed.`, {
			code: 'ZANI_E_ATTRIBUTE_ALREADY_INDEXED',
			statusCode: 409,
			context: { attribute: attribute, collection: collection},
		});
	}
}
