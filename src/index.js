// Node Imports
const fs = require('fs');

// Custom Import
const Zani = require('./zani');
const BPlusTree = require('./bPlusTree');

/** This is a basic test file for ZaniJS to ensure it is functioning as intended.
 *
 * @author Brock Kitterman <brock.kitterman@gmail.com>
 */

var db = new Zani('Test', { fileLimit: 100 });
main();

async function main() {
	//! Testing note; What happens if a query requests an attribute not present?
	/* 
	! Things to test
	- Uppercase/lowercase on things like $gt -> $Gt/gT
	- Query check, making sure things are used properly rather than just 'where they fit'
	- Test object nesting with more defined data. works as is now in non-indexed files
	// */
	var options = { 
		autofillAttributes: 1,
		attributes: {  
			value: {required: true},
			val: {autofillValue: 0},
			thing: {}
		} 
	};
	db.configureCollectionOptions(options)
	console.log(options);
	console.log(
		db.validateEntry('Testing', { _id: 1000, value: 1}, true, options),
	);

	// await buildDatabase();
}

async function buildDatabase() {
	db.deleteCollection('Testing');
	await new Promise((resolve) => setTimeout(resolve, 1000));

	db.createCollection('Testing');

	for (let j = 0; j < 40; j++) {
		for (let i = 0; i < 300; i++) {
			db.addEntry('Testing', {
				value: i + j * 300,
				nonIndexedValue: j,
				insertion: { num: i * j },
			});
		}
		db.logger.warn('File batch ended, pausing', 'Test Server');
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
}
