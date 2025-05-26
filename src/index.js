// Node Imports
const fs = require('fs');

/** This is a basic test file for ZaniJS to ensure it is functioning as intended.
 *
 * @author Brock Kitterman <brock.kitterman@gmail.com>
 */

// Custom Import
const Zani = require('./zani');
var db = new Zani('Test');
main();

//! WARNING: Zani only works with BASE LEVEL. It cannot consider nested objects. Need fixed.

async function main() {
	//searchTest();
	//createTestCollection();

}

function createTestCollection() {
	db.createCollection('TestCollection');

	for (let i = 0; i < 50; i++) {
		db.addEntry('TestCollection', { value: 50 - i });
	}
}

async function searchTest() {
	var result = await db.find('NULL', {
		$exists: '_id',
	});

	console.log('\n\n---------------Results---------------');
	console.log(result);
	console.log('\n');
}
