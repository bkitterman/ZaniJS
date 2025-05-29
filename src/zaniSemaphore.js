// Custom Imports
const Queue = require('./queue');

/** A basic semaphore class for use in the ZaniJS system
 * 
 * @author Brock Kitterman
 */
class ZaniSemaphore {
    /** Create a new semaphore object
     * 
     * @param {number} maxConcurrency - Define how many units can be processed at a time. Defaults to 1.
     */
    constructor(maxConcurrency = 1) {
        this.maxConcurrency = maxConcurrency;
        this.current = 0;
        this.queue = new Queue();
    }

    /** Acquire the semaphore. If the semaphore value is less than maxConcurrency, the semaphore will permit
     * passing. If the value is greater than, it will block the process until enough units complete. 
     */
    acquire() {
        return new Promise((resolve) => {
            if (this.current < this.maxConcurrency) {
                this.current++;
                resolve();
            } else {
                this.queue.enqueue(resolve);
            }
        });
    }

    /** Decrements the semaphore value, allowing the next process to proceeded.
     * 
     */
    release() {
        if (!this.queue.isEmpty()) {
            const next = this.queue.dequeue();
            next();
        } else {
            if (this.current > 0) {
                this.current--;
            }
        }
    }
}

module.exports = ZaniSemaphore;