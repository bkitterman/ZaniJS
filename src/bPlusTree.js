// Node Imports
const fs = require('fs');

class bPlusTreeNode {
	constructor(isLeaf, id) {
		this.isLeaf = isLeaf || false;
		this.keys = [];
		this.id = id;

		if (isLeaf) {
			this.values = {};
			this.next = null;
			this.previous = null;
		} else {
			this.children = [];
		}
	}
}

class BPlusTree {

    meta = {order: null, nodeCount: null, root: null};

	constructor(path, order) {
		this.path = path + '\\';
		this.meta.order = order;

		// Get meta data if it exists
		if (fs.existsSync(this.path + 'tree.json')) {
			this.meta = JSON.parse(fs.readFileSync(this.path + 'tree.json'));
		}
		this.meta.nodeCount = this.meta.nodeCount || 1;
        this.meta.root = this.meta.root || 0;

		// Check root node, if undefined, create root node
		if (!fs.existsSync(this.path + this.meta.root + '.json')) {
			this.root = new bPlusTreeNode(true, 0);
            this.saveNode(this.root);
            this.saveMeta();
		} else 
            this.loadNode(this.meta.root);
	}

	search(key) {
		let current = this.root;

		while (!current.isLeaf) {
			let i = 0;
			while (i < current.keys.length && key >= current.keys[i]) {
				i++;
			}
			current = this.loadNode(current.children[i]);
		}

		// At leaf
		return current.values[key] || null;
	}

	insert(key, value) {
        this.updatedMetaValues = false; // Reset
		const result = this.insertRecursive(this.root, key, value);

		// If value is returned, overflow occurred. Split and rebalance
		if (result && result.promoteKey) {
			const newRoot = new bPlusTreeNode(false, this.meta.nodeCount++);
			newRoot.keys.push(result.promoteKey);
			newRoot.children.push(this.root.id, result.newNode.id);
			this.root = newRoot;

            this.saveNode(this.root);
            this.updatedMetaValues = true;
		}

        // Only run if meta is updated
        if(this.updatedMetaValues) this.saveMeta();
	}

	insertRecursive(node, key, value) {
		//* The node is already an object in memory at this point.

		// If node is a leaf, attempt insert
		if (node.isLeaf) {
			if (!node.values[key]) node.keys.push(key);
			node.values[key] = node.values[key] || [];
			node.values[key].push(value);

			node.keys.sort((a, b) => (a > b ? 1 : -1));

			// Push changes to disk
            this.saveNode(node);

			// If node overflow, split node
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

		if (result && result.promoteKey) {
			node.keys.splice(i, 0, result.promoteKey);
			node.children.splice(i + 1, 0, result.newNode.id);

			// Push changes to disk
            this.saveNode(node);

			if (node.keys.length > this.meta.order) {
				return this.splitInternalRecursive(node);
			}
		}

		return;
	}

	splitLeafRecursive(node) {
		const mid = Math.ceil(node.keys.length / 2);
		const newLeaf = new bPlusTreeNode(true, this.meta.nodeCount++);
        this.updatedMetaValues = true;

		const keysToMove = node.keys.splice(mid);
		for (const k of keysToMove) {
			newLeaf.keys.push(k);
			newLeaf.values[k] = node.values[k];
			delete node.values[k];
		}

		// Link leaves
		newLeaf.next = node.next;
		if (newLeaf.next) {
            const nextLeaf = this.loadNode(newLeaf.next);
            nextLeaf.previous = newLeaf.id;
            this.saveNode(nextLeaf);
        }
		node.next = newLeaf.id;
		newLeaf.previous = node.id;

        this.saveNode(node);
        this.saveNode(newLeaf);

		return {
			promoteKey: newLeaf.keys[0],
			newNode: newLeaf,
		};
	}

	splitInternalRecursive(node) {
		const mid = Math.floor(node.keys.length / 2);
		const promoteKey = node.keys[mid];

		const newInternal = new bPlusTreeNode(false, this.meta.nodeCount++);
        this.updatedMetaValues = true;

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
	/*                              Helper Functions                              */
	/* -------------------------------------------------------------------------- */

	saveNode(node) {
		fs.writeFileSync(this.path + this.formatId(node.id) + '.json', JSON.stringify(node));
	}

	loadNode(id) {
		return JSON.parse(fs.readFileSync(this.path + this.formatId(id) + '.json'));
	}

    formatId(id) {
        return typeof id === "string" ? id.padStart(6, "0") : String(id).padStart(6, "0");
    }

    saveMeta() {
        fs.writeFileSync(this.path + "tree.json", JSON.stringify(this.meta));
    }
}

module.exports = BPlusTree;
