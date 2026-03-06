// 1. Two Sum
// Difficulty: Easy
// https://leetcode.com/problems/two-sum/

function twoSum(nums: number[], target: number): number[] {

  let m: Record<number, number> = {};
  for (let i = 0; i < nums.length; i++) {
    let val = target - nums[i];
    if(!(val in m)){
      m[nums[i]] = i;
    }else{
      return [m[val], i]
    }
  }
  return [];
};

{
  console.log(twoSum([2,7,11,15], 9));
}

{
  console.log(twoSum([2,7,11,15], 9));
}

{
  console.log(twoSum([3,2,4], 6));
}

{
  console.log(twoSum([3,3], 6));
}
