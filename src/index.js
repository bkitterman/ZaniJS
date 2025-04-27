/** This is a basic test file for ZaniJS to ensure it is functioning as intended.
 *
 * @author Brock Kitterman <brock.kitterman@gmail.com>
 */

// Custom Import
const Zani = require('./zani');
main();

async function main() {
	var db = new Zani('Test');
	var result = await db.find('tester2', {
		_id: 32, // Cannot read last value for some reason
	}, {
		_id: 1,
		value: 1
	});

	console.log('\n\n---------------Results---------------')
	console.log(result);
	console.log('\n');
}
