import ZaniError from './zaniError.js';

/** An error thrown when an collection exists in the database meta.json file, but the collection does
 * not exist at the expected location in the file system.
 *
 * @extends ZaniError
 *
 * @author Brock Kitterman <brock.kitterman@gmail.com>
 */
export default class CollectionFolderNotFound extends ZaniError {
	/** Create a new instance of the CollectionFolderNotFound class.
	 *
	 * @example
	 * throw new CollectionFolderNotFound('users');
	 *
	 * @param {string} collection - The name of the collection
	 * @param {string} path - The expected destination of the collection
	 */
	constructor(collection, path) {
		super(
			`Collection folder for "${collection}" cannot be located. However, it does exist in ` +
				`the meta.json file. \n\n\tExpected destination: ${path}`,
			{
				code: 'ZANI_E_COLLECTION_FOLDER_NOT_FOUND',
				statusCode: 500,
				context: { collection: collection, path: path },
			},
		);
		this.collection = collection;
	}
}
