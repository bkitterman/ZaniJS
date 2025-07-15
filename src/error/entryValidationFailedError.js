import ZaniError from './zaniError.js';

/** An error thrown when a an entry, or update to an entry, failed to pass validation set by
 * the user and collection settings.
 *
 * @extends ZaniError
 *
 * @author Brock Kitterman <brock.kitterman@gmail.com>
 */
export default class EntryValidationFailedError extends ZaniError {
	/** Create a new instance of the EntryValidationFailedError class.
	 *
	 * @example
	 * throw new EntryValidationFailedError('users', 'email', 'datatype', 'string', 'number');
	 *
	 * @param {string} collection - The name of the collection
	 * @param {string} attribute - The name of the attribute
     * @param {string} setting - The setting violated
     * @param {any} value - The expected value
     * @param {any} invalidValue - The provided value
	 */
	constructor(collection, attribute, setting, value, invalidValue) {
		if (Array.isArray(value)) value = value.toString();
		else if (setting === 'domain') value = value.lower + ' <= x <= ' + value.upper;

		super(
			`The entry/update in ${collection} has failed to pass validation check ${setting} at ` +
				`attribute(s) ${attribute}.\n\n` +
				`\tExcepted value: ${value}` +
				`\tReceived value: ${invalidValue}`,
			{
				code: 'ZANI_E_ENTRY_FAILED_VALIDATION',
				statusCode: 409,
				context: {
					collection: collection,
					attribute: attribute,
					setting: setting,
					value: value,
					invalidValue: invalidValue,
				},
			},
		);
	}
}
