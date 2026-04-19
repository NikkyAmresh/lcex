// 2813. To Be Or Not To Be
// Difficulty: Easy
// https://leetcode.com/problems/to-be-or-not-to-be/

type ToBeOrNotToBe = {
    toBe: (val: any) => boolean;
    notToBe: (val: any) => boolean;
};

function expect(val: any): ToBeOrNotToBe {
  return {
      toBe: (res) => {
        if (res===val){
            return true
        }
        throw new Error("Not Equal");
      },
      notToBe: (res) => {
        if (res!==val){
          return true
      }
      throw new Error("Equal");
      }
  }
};

/**
 * expect(5).toBe(5); // true
 * expect(5).notToBe(5); // throws "Equal"
 */

{
  console.log(expect("() => expect(5).toBe(5)"));
}

{
  console.log(expect("() => expect(5).toBe(5)"));
}

{
  console.log(expect("() => expect(5).toBe(null)"));
}

{
  console.log(expect("() => expect(5).notToBe(null)"));
}
