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
		$or: { 
			value: { $lte: 10, $gt: 3 },
			_id: 22,
		},
		$not: {value: {$gte: 40}},
		_id: 32,
	}, {
		_id: 1,
		value: 1
	});

	console.log(result);
}
