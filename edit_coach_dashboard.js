const fs = require('fs');  
let s = fs.readFileSync("d:\hdd\templates\fitness\coach-dashboard.html", 'utf8');  
const lines = s.split(String.fromCharCode(10));  
let found = false;  
