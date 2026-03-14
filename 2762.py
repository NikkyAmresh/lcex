# 2762. Cache With Time Limit
# Difficulty: Medium
# https://leetcode.com/problems/cache-with-time-limit/

class TimeLimitedCache {
    
    constructor() {
        
    }
    
    set(key: number, value: number, duration: number): boolean {
        
    }
    
    get(key: number): number {
        
    }
    
    count(): number {
        
    }
}

/**
 * const timeLimitedCache = new TimeLimitedCache()
 * timeLimitedCache.set(1, 42, 1000); // false
 * timeLimitedCache.get(1) // 42
 * timeLimitedCache.count() // 1
 */

print(fn(["TimeLimitedCache","set","get","count","get"]))
print(fn([[],[1,42,100],[1],[],[1]]))
print(fn([0,0,50,50,150]))
print(fn(["TimeLimitedCache","set","get","count","get"]))
print(fn([[],[1,42,100],[1],[],[1]]))
print(fn([0,0,50,50,150]))
print(fn(["TimeLimitedCache","set","set","get","get","get","count"]))
print(fn([[],[1,42,50],[1,50,100],[1],[1],[1],[]]))
print(fn([0,0,40,50,120,200,250]))
