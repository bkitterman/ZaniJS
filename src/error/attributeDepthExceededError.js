const ZaniError = require('./zaniError');

/** An error thrown when a attempting an operation with a max attribute depth, which the provided
 * attribute has exceeded.
 *
 * @extends ZaniError
 *
 * @author Brock Kitterman <brock.kitterman@gmail.com>
 */
class AttributeDepthExceededError extends ZaniError {
	/** Create a new instance of the AttributeDepthExceededError class.
	 *
	 * @example
	 * throw new AttributeDepthExceededError(['user', 'id'], 1, 'get');
	 *
	 * @param {string} attribute - The attribute used
	 * @param {number} maxDepth - The max depth of the operation
	 * @param {string} operation - The operation attempted
	 */
	constructor(attribute, maxDepth, operation) {
		super(
			`The attribute ${attribute.join('.')} exceeds the max depth of the operation with depth ` +
				`${attribute.length}. The operation ${operation} has a max depth of ${maxDepth}.`,
			{
				code: 'ZANI_E_ATTRIBUTE_DEPTH_EXCEEDED',
				statusCode: 403,
				context: {
					attribute: attribute.join('.'),
					attributeDepth: attribute.length,
					maxDepth: maxDepth,
					operation: operation,
				},
			},
		);
	}
}

module.exports = AttributeDepthExceededError;
