/** Basic node for a queue */
class QueueNode {
    constructor(value) {
        this.value = value;
        this.next = null;
    }
}

/** A basic queue class for use in the ZaniSemaphore Object
 * 
 * @author Brock Kitterman
 */
class Queue {
    constructor() {
        this.head = null;
        this.tail = null;
        this.length = 0;
    }

    /** Add a node to the queue
     * 
     * @param {any} value - The item to store at the new node
     */
    enqueue(value) {
        const node = new QueueNode(value);
        if (this.tail) {
            this.tail.next = node;
        } else {
            this.head = node;
        }

        this.tail = node;
        this.length++;
    }

    /** Remove the first node from the queue
     * 
     * @returns The value of the removed node
     */
    dequeue() {
        if (!this.head) return undefined;

        const value = this.head.value;
        this.head = this.head.next;

        if (!this.head) this.tail = null;
        this.length--;
        
        return value;
    }

    /** Returns tree if the queue is empty */
    isEmpty() {
        return this.length === 0;
    }

    /** Returns the length of the queue */
    size() {
        return this.length;
    }
}

module.exports = Queue;
