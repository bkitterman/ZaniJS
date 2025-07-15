// Node Imports
import fs from 'fs';
import path from 'path';

/** A simple node object for a BPlusTree.
 *
 * @author Brock Kitterman
 */
class bPlusTreeNode {
	/** Create a new node object.
	 *
	 * @param {boolean} isLeaf - True if the node is a leaf, false otherwise.
	 * @param {number} id - The nodes id, which wil lbe used for file naming, and identification among other nodes.
	 */
	constructor(isLeaf, id) {
		this.isLeaf = isLeaf || false;
		this.id = id;
		this.keys = [];

		if (isLeaf) {
			this.values = {};
			this.next = null;
			this.previous = null;
		} else {
			this.children = [];
		}
	}
}

/** A BPlustTree object that is entirely in-disk. Order, nodeCount, and the current root are all stored in tree.json
 * meta file, whilst all nodes are stored in individual files based upon their node id.
 *
 * @author Brock Kitterman
 */
export default class BPlusTree {
	meta = { order: null, nodeCount: null, root: null };

	/** Create a new BPlustTree object. If the provided path contains a tree.json file, it will load an existing
	 * tree. If it does not exist, a new tree will be made based on the passed order value.
	 *
	 * @param {string} path - The path to be used for a tree. Do not end with a '\' as it will be appended in file.
	 * @param {number} order - The order, or maximum number of keys, stored at any given node.
	 */
	constructor(path, order) {
		this.path = path;
		this.meta.order = order || 100;

		const metaPath = path.join(this.path, 'tree.json');

		// Get meta data if it exists
		if (fs.existsSync(metaPath)) {
			this.meta = JSON.parse(fs.readFileSync(metaPath));
		}
		this.meta.nodeCount = this.meta.nodeCount || 1;
		this.meta.root = this.meta.root || 0;

		// Check root node, if undefined, create root node
		const rootPath = path.join(this.path, this.formatId(this.meta.root)+'.json');
		if (!rootPath) {
			this.root = new bPlusTreeNode(true, 0);
			this.saveNode(this.root);
			this.saveMeta();
		} else this.root = this.loadNode(this.meta.root);
	}

	/* -------------------------------------------------------------------------- */
	/*                               Search Methods                               */
	/* -------------------------------------------------------------------------- */

	/** Given a key, search the tree for its associated results, such as a pointer or other value. This will
	 * return all results, which will be an array of the stored data type, or null if not found/present in
	 * the tree.
	 *
	 * @param {any} key - The key to search for (number or string).
	 * @returns {any[]|null} - Array of values for the key, or null if not found.
	 */
	search(key) {
		let current = this.root;

		// Traverse down the tree until the desired leaf
		while (!current.isLeaf) {
			let i = 0;
			while (i < current.keys.length && key >= current.keys[i]) {
				i++;
			}
			current = this.loadNode(current.children[i]);
		}

		// At leaf, return key if present, null if not
		return current.values[key] || null;
	}

	/** Returns the maximum, or last, key in the tree.
	 *
	 * @returns {any} - The last key in the tree
	 */
	getMaxValue() {
		let current = this.root;
		let i = 0;

		// Traverse down the tree until the desired leaf
		while (!current.isLeaf) {
			i = current.children.length - 1;
			current = this.loadNode(current.children[i]);
		}

		// At leaf, return key if present, null if not
		return current.keys[current.keys.length - 1];
	}

	/** Returns the minimum, or first, key in the tree.
	 *
	 * @returns {any} - The first key in the tree
	 */
	getMinValue() {
		let current = this.root;

		// Traverse down the tree until the desired leaf
		while (!current.isLeaf) {
			current = this.loadNode(current.children[0]);
		}

		// At leaf, return key if present, null if not
		return current.keys[0];
	}

	/** Return all indexes that have the key ranges. It will return all values stored at start<=x<=end.
	 *
	 * @param {any} start - The minium value of the range (Inclusive)
	 * @param {any} end - The max value of the range (Inclusive)
	 * @returns
	 */
	getRange(start, end) {
		let current = this.root;

		if (start > end) return [];

		// Traverse down the tree until the desired leaf
		while (!current.isLeaf) {
			let i = 0;
			while (i < current.keys.length && start >= current.keys[i]) {
				i++;
			}
			current = this.loadNode(current.children[i]);
		}

		// Traverse chain until end value, return
		let key = start;
		let results = [];
		while (key <= end) {
			let keyArray = Object.getOwnPropertyNames(current.values);

			for (key of keyArray) {
				if (key < start) continue;
				if (key > end) return results;
				results.push(...current.values[key]);
			}

			// Ensure next node
			if (current.next === null) {
				return results;
			}
			current = this.loadNode(current.next);
		}

		return results;
	}

	/* -------------------------------------------------------------------------- */
	/*                              Insertion Methods                             */
	/* -------------------------------------------------------------------------- */

	/** Insert the desired value at the key's location within the tree. if the key must be inserted, the tree
	 * will do so and self balance. If the key is already present, the key's value array will be appended with
	 * the new desired value.
	 *
	 * @param {any} key - The key to insert or update.
	 * @param {any} value - The value to store at the key.
	 */
	insert(key, value) {
		if (!key || !value) return;

		this.updatedMetaValues = false; // Reset
		const result = this.insertRecursive(this.root, key, value);

		// If value is returned, overflow occurred. Split and rebalance and assign new root
		if (result && result.promoteKey) {
			const newRoot = new bPlusTreeNode(false, this.meta.nodeCount++);
			newRoot.keys.push(result.promoteKey);
			newRoot.children.push(this.root.id, result.newNode.id);
			this.root = newRoot;
			this.meta.root = newRoot.id;

			// Push changes to disk
			this.saveNode(this.root);
			this.updatedMetaValues = true;
		}

		// Only run if meta is updated
		if (this.updatedMetaValues) this.saveMeta();
	}

	/** Helper method for {@link BPlusTree#insert}. Traverse through both internal and leaf nodes to find
	 * desired location for key. Then, insert value where needed. If overflow occurs during this process, it
	 * will initiate rebalancing.
	 *
	 * In the even of a level overflow, return the promoted key and new node up to the previous/lower
	 * call on the method stack to handle.
	 *
	 * @param {object} node - The node to traverse at.
	 * @param {any} key - The key to insert.
	 * @param {any} value - The value to insert.
	 * @returns {object|undefined} - If split occurs, returns { promoteKey, newNode }.
	 */
	insertRecursive(node, key, value) {
		// If node is a leaf, attempt insert
		if (node.isLeaf) {
			if (!Object.hasOwnProperty.call(node.values, key)) node.keys.push(key);
			node.values[key] = node.values[key] || [];
			node.values[key].push(value);

			node.keys.sort((a, b) => (a > b ? 1 : -1));

			// Push changes to disk
			this.saveNode(node);

			// If node overflow, split leaf node
			if (node.keys.length > this.meta.order) {
				return this.splitLeafRecursive(node);
			}
			return;
		}

		// Internal node, traverse through keys array for matching, or for next level within range of desired key
		let i = 0;
		while (i < node.keys.length && key >= node.keys[i]) i++;

		// Traverse to next node
		const result = this.insertRecursive(this.loadNode(node.children[i]), key, value);

		// If overflow occurred at higher call (lower level of tree), handle
		if (result && result.promoteKey) {
			node.keys.splice(i, 0, result.promoteKey);
			node.children.splice(i + 1, 0, result.newNode.id);

			// Push changes to disk
			this.saveNode(node);

			// If internal node overflow occurs, handle.
			if (node.keys.length > this.meta.order) {
				return this.splitInternalRecursive(node);
			}
		}
		return;
	}

	/** Helper method for {@link BPlusTree#insert}. When an overflow occurs at a leaf node, create a new leaf
	 * node after the overflowing node, split keys/2 to new node. This place the nodes in order of
	 *
	 * @example node -> new node > next node
	 *
	 * Return the key that needs promotion to the parent internal node through recursion, along with the newLeaf
	 * to be added to parentInternalNode.children array.
	 *
	 * @param {object} node - The overflowing leaf node.
	 * @returns {object} - { promoteKey, newNode }
	 */
	splitLeafRecursive(node) {
		// Prepare keys for split
		const mid = Math.ceil(node.keys.length / 2);
		const newLeaf = new bPlusTreeNode(true, this.meta.nodeCount++);
		this.updatedMetaValues = true;

		// Move keys to each node (First half to old, second half to new)
		const keysToMove = node.keys.splice(mid);
		for (const k of keysToMove) {
			newLeaf.keys.push(k);
			newLeaf.values[k] = node.values[k];
			delete node.values[k];
		}

		// Link leaves together for chaining
		newLeaf.next = node.next;
		if (newLeaf.next) {
			const nextLeaf = this.loadNode(newLeaf.next);
			nextLeaf.previous = newLeaf.id;
			this.saveNode(nextLeaf);
		}
		node.next = newLeaf.id;
		newLeaf.previous = node.id;

		// Push changes to disk
		this.saveNode(node);
		this.saveNode(newLeaf);

		return {
			promoteKey: newLeaf.keys[0],
			newNode: newLeaf,
		};
	}

	/** Helper method for {@link BPlusTree#insert}. When an overflow occurs at a internal node, create a new internal
	 * node after the overflowing node, split keys/2 to new node. This place the nodes in order of
	 *
	 * @example node -> new node > next node
	 *
	 * Return the key that needs promotion to the parent internal node through recursion, along with the newInternal
	 * to be added to parentInternalNode.children array.
	 *
	 * @param {object} node - The overflowing internal node.
	 * @returns {object} - { promoteKey, newNode }
	 */
	splitInternalRecursive(node) {
		const mid = Math.floor(node.keys.length / 2);
		const promoteKey = node.keys[mid];

		const newInternal = new bPlusTreeNode(false, this.meta.nodeCount++);
		this.updatedMetaValues = true;

		// Move keys to each node (First half to old, second half to new)
		newInternal.keys = node.keys.splice(mid + 1);
		newInternal.children = node.children.splice(mid + 1);
		node.keys.pop(); // remove mid key from original

		// Push changes to disk
		this.saveNode(node);
		this.saveNode(newInternal);

		return {
			promoteKey,
			newNode: newInternal,
		};
	}

	/* -------------------------------------------------------------------------- */
	/*                              Deletion Methods                              */
	/* -------------------------------------------------------------------------- */

	/** Remove a value form the BPLusTree. THis will delete 1 instance at the desired key that matches
	 * valueToRemove. If this is the only, or last, value within that key, it will delete the entire key and
	 * rebalance the tree, if needed.
	 *
	 * Returns a boolean depending on deletion success.
	 *
	 * @param {any} key - The key to delete from.
	 * @param {any} valueToRemove - The value to remove.
	 * @returns {boolean} - True if deletion occurred, false otherwise.
	 */
	delete(key, valueToRemove) {
		const result = this.deleteRecursive(this.root, key, valueToRemove);

		// If root has only one child and is internal, promote the child
		if (!this.root.isLeaf && this.root.keys.length === 0) {
			const newRootId = this.root.children[0];
			this.root = this.loadNode(newRootId);
			this.meta.root = this.root.id;
			this.saveMeta();
		}
		return result;
	}

	/** Helper method for {@link BPlusTree#delete}. Traverse through both internal and leaf nodes to find
	 * desired location for key. Then, delete value where needed. If underflow occurs during this process, it
	 * will initiate rebalancing.
	 *
	 * Depending on deletion results, a boolean value will be passed back down teh stack to handle potential
	 * changes at all levels of the tree.
	 *
	 * @param {object} node - The node to traverse.
	 * @param {any} key - The key to delete from.
	 * @param {any} valueToRemove - The value to remove.
	 * @returns {boolean} - True if deletion occurred, false otherwise.
	 */
	deleteRecursive(node, key, valueToRemove) {
		// If at leaf, remove value from key
		if (node.isLeaf) {
			// Check if key is in values
			if (!Object.hasOwnProperty.call(node.values, key)) return false;

			// Check if valueToRemove is within the key's value array.
			const index = node.values[key].indexOf(valueToRemove);
			if (index === -1) return false;

			// Remove valueToRemove from the value array
			node.values[key].splice(index, 1);

			// If no more values for this key, remove the key entirely
			if (node.values[key].length === 0) {
				delete node.values[key];
				const keyIndex = node.keys.indexOf(key);
				if (keyIndex !== -1) node.keys.splice(keyIndex, 1);

				// Push changes to disk
				this.saveNode(node);

				// Check underflow after full key deletion
				if (node !== this.root && node.keys.length < Math.ceil(this.meta.order / 2)) {
					this.rebalanceLeaf(node);
				}
			} else {
				// Push changes to disk
				this.saveNode(node);
			}

			// if deletion successful, return true
			return true;
		}

		// Internal node
		let i = 0;
		while (i < node.keys.length && key >= node.keys[i]) i++;

		// Traverse to next node
		const child = this.loadNode(node.children[i]);
		const deleted = this.deleteRecursive(child, key, valueToRemove);

		// If deletion was successful, update internal node if needed.
		if (deleted) {
			// If key is in internal node, delete it
			if (i < node.keys.length) {
				// Bring up next value to update internal node pointer
				const nextChild = this.loadNode(node.children[i + 1]);
				if (nextChild.keys.length > 0) {
					node.keys[i] = nextChild.keys[0];
				}
				this.saveNode(node);
			}

			// if underflow, rebalance internal node
			if (child.keys.length < Math.ceil(this.meta.order / 2)) {
				this.rebalanceInternal(node, i);
			}
		}

		// Pass deletion results up stack to ensure all changes are recorded
		return deleted;
	}

	rebalanceLeaf(node) {
		// Acquire parent node
		const parent = this.findParent(this.root, node.id);
		if (!parent) return; // Root node

		const index = parent.children.indexOf(node.id);
		const leftSibling = index > 0 ? this.loadNode(parent.children[index - 1]) : null;
		const rightSibling =
			index < parent.children.length - 1 ? this.loadNode(parent.children[index + 1]) : null;

		// If space in left node, borrow from left
		if (leftSibling && leftSibling.keys.length > Math.ceil(this.meta.order / 2)) {
			const borrowedKey = leftSibling.keys.pop();
			node.keys.unshift(borrowedKey);
			node.values[borrowedKey] = leftSibling.values[borrowedKey];
			delete leftSibling.values[borrowedKey];

			parent.keys[index - 1] = node.keys[0];

			this.saveNode(leftSibling);
			this.saveNode(node);
			// If space in right node, borrow form right
		} else if (rightSibling && rightSibling.keys.length > Math.ceil(this.meta.order / 2)) {
			const borrowedKey = rightSibling.keys.shift();
			node.keys.push(borrowedKey);
			node.values[borrowedKey] = rightSibling.values[borrowedKey];
			delete rightSibling.values[borrowedKey];

			parent.keys[index] = rightSibling.keys[0];

			this.saveNode(rightSibling);
			this.saveNode(node);
			// If left sibling, merge with left
		} else if (leftSibling) {
			leftSibling.keys = leftSibling.keys.concat(node.keys);
			Object.assign(leftSibling.values, node.values);
			leftSibling.next = node.next;
			if (node.next) {
				const nextNode = this.loadNode(node.next);
				nextNode.previous = leftSibling.id;
				this.saveNode(nextNode);
			}
			parent.keys.splice(index - 1, 1);
			parent.children.splice(index, 1);

			// Push changes to disk
			this.saveNode(leftSibling);
			fs.unlinkSync(path.join(this.path, this.formatId(node.id)+'.json'));

			// Update parent key after merge
			if (index - 1 < parent.keys.length && parent.children[index]) {
				const rightChild = this.loadNode(parent.children[index]);
				parent.keys[index - 1] = rightChild.keys[0];
			}
			// if right sibling, merge with right
		} else if (rightSibling) {
			node.keys = node.keys.concat(rightSibling.keys);
			Object.assign(node.values, rightSibling.values);
			node.next = rightSibling.next;
			if (rightSibling.next) {
				const nextNode = this.loadNode(rightSibling.next);
				nextNode.previous = node.id;
				this.saveNode(nextNode);
			}
			parent.keys.splice(index, 1);
			parent.children.splice(index + 1, 1);

			// Push changes to disk
			this.saveNode(node);
			fs.unlinkSync(path.join(this.path, this.formatId(node.id) + '.json'));

			// Update parent key after merge
			if (index < parent.keys.length && parent.children[index + 1]) {
				const rightChild = this.loadNode(parent.children[index + 1]);
				parent.keys[index] = rightChild.keys[0];
			}
		}

		// Push changes to disk
		this.saveNode(parent);
		this.saveMeta();
	}

	// Rebalance an internal node after deletion if underflow occurs
	rebalanceInternal(node, index) {
		const parent = this.findParent(this.root, node.id);
		if (!parent) return; // Root node

		const parentIndex = parent.children.indexOf(node.id);
		const leftSibling = parentIndex > 0 ? this.loadNode(parent.children[parentIndex - 1]) : null;
		const rightSibling =
			parentIndex < parent.children.length - 1
				? this.loadNode(parent.children[parentIndex + 1])
				: null;

		// Borrow from left sibling
		if (leftSibling && leftSibling.keys.length > Math.ceil(this.meta.order / 2)) {
			const borrowedKey = leftSibling.keys.pop();
			const borrowedChild = leftSibling.children.pop();
			node.keys.unshift(parent.keys[parentIndex - 1]);
			node.children.unshift(borrowedChild);
			parent.keys[parentIndex - 1] = borrowedKey;

			this.saveNode(leftSibling);
			this.saveNode(node);
			this.saveNode(parent);
			// Borrow from right sibling
		} else if (rightSibling && rightSibling.keys.length > Math.ceil(this.meta.order / 2)) {
			const borrowedKey = rightSibling.keys.shift();
			const borrowedChild = rightSibling.children.shift();
			node.keys.push(parent.keys[parentIndex]);
			node.children.push(borrowedChild);
			parent.keys[parentIndex] = borrowedKey;

			this.saveNode(rightSibling);
			this.saveNode(node);
			this.saveNode(parent);
			// Merge with left sibling
		} else if (leftSibling) {
			leftSibling.keys.push(parent.keys[parentIndex - 1], ...node.keys);
			leftSibling.children.push(...node.children);
			parent.keys.splice(parentIndex - 1, 1);
			parent.children.splice(parentIndex, 1);

			this.saveNode(leftSibling);
			fs.unlinkSync(path.join(this.path, this.formatId(node.id) + '.json'));

			// Update parent key after merge
			if (parentIndex - 1 < parent.keys.length && parent.children[parentIndex]) {
				const rightChild = this.loadNode(parent.children[parentIndex]);
				parent.keys[parentIndex - 1] = rightChild.keys[0];
			}
		} else if (rightSibling) {
			node.keys.push(parent.keys[parentIndex], ...rightSibling.keys);
			node.children.push(...rightSibling.children);
			parent.keys.splice(parentIndex, 1);
			parent.children.splice(parentIndex + 1, 1);

			this.saveNode(node);
			fs.unlinkSync(path.join(this.path, this.formatId(node.id) + '.json'));

			// Update parent key after merge
			if (parentIndex < parent.keys.length && parent.children[parentIndex + 1]) {
				const rightChild = this.loadNode(parent.children[parentIndex + 1]);
				parent.keys[parentIndex] = rightChild.keys[0];
			}
		}
		this.saveNode(parent);
		this.saveMeta();

		// If parent under-flows, rebalance recursively
		if (parent !== this.root && parent.keys.length < Math.ceil(this.meta.order / 2)) {
			const grandParent = this.findParent(this.root, parent.id);
			if (grandParent) {
				const grandIndex = grandParent.children.indexOf(parent.id);
				this.rebalanceInternal(parent, grandIndex);
			}
		}
	}

	/** From current node, traverse tree in search of desired child, and return the node object.
	 *
	 * @param {object} current - The current node object to start the search.
	 * @param {number} childId - The id of the desired child node.
	 * @returns {object}
	 */
	findParent(current, childId) {
		// If leaf node, return nothing as there is no child
		if (current.isLeaf || !current.children) return null;

		// Traverse through children to find parent
		for (const child of current.children) {
			if (child === childId) return current;
			const node = this.loadNode(child);
			const result = this.findParent(node, childId);
			if (result) return result;
		}

		// Child not found
		return null;
	}

	/* -------------------------------------------------------------------------- */
	/*                              Helper Functions                              */
	/* -------------------------------------------------------------------------- */

	/** Save the passed node object to its corresponding file via its ID.
	 *
	 * @param {object} node - The node object to be saved to disk/file
	 */
	saveNode(node) {
		fs.writeFileSync(path.join(this.path, this.formatId(node.id) + '.json'), JSON.stringify(node));
	}

	/** Load the passed node ID into a node object from its file.
	 *
	 * @param {number} node - The node id to be loaded from disk/file
	 * @returns {object}
	 */
	loadNode(id) {
		return JSON.parse(fs.readFileSync(path.join(this.path, this.formatId(node.id) + '.json')));
	}

	/** Return the id passed as a padding string of length 6.
	 *
	 * @example
	 * ID: 0 -> 000000
	 * ID: 123 -> 000123
	 * ID: 123456 -> 123456
	 *
	 * @param {number} id - The node id to format
	 * @returns {string}
	 */
	formatId(id) {
		return typeof id === 'string' ? id.padStart(6, '0') : String(id).padStart(6, '0');
	}

	/** Push the current meta data object to its file tree.json. */
	saveMeta() {
		fs.writeFileSync(path.join(this.path, `tree.json`), JSON.stringify(this.meta));
	}
}
