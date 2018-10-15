/* SLAVE */
const fs      = require('fs');
const https   = require('https')
const redis   = require('redis')
var io        = require('socket.io')
const isJSON  = require('is-json')
const mysql_client   = require('./db_client_remake.js');
const aes            = require('./AES_Helper.js')
crypto_random_string = require('crypto-random-string')

var port = 8081
var redisClient = redis.createClient();
var local_set_time, global_set_time;


// {"userToken":"..","content":".."}
function checkInitialJSONStructure(json) {
	if(typeof(json.userToken) != "string" || typeof(json.content) != "object") 
		return false;
	return true;
}

function checkContentJSONStructure(json) {
	if(typeof(json.envelope) != "string" || typeof(json.payload) != "object") 
		return false;
	let str_payload = JSON.stringify(json.payload)
	return isJSON(str_payload)
}

function getProperFunction(envelope) {
	console.log("entro in getProperFunction..")
	switch(envelope) {
		case "function_one":
			return function_one
			break;
		default:
			return null;
	}
}

function function_one(json,callback) {
	name = json.name
	res  = "Hello "+name 
	json_result = JSON.stringify({"result":res})	
	callback({ result : json_result })	
}


var sslOptions = {
	key: fs.readFileSync('ssl/key.pem'),
	cert: fs.readFileSync('ssl/cert.pem')
};

/* {"userToken":"..","content":"envelope":"..","payload":{..}} */
var s = https.createServer(sslOptions, (req,res) => {
			console.log("Request: "+req.method+" URL: "+req.url)
			var data = ''
			var dataSize = 0
			req.setEncoding('utf8') // if an encoding is not set, Buffer objects are received

			req.on('data', (chunk) => {
		   	 	console.log(`Received ${chunk.length} bytes of data. Type ${chunk.constructor.name}`)
		     	data += chunk;
		     	dataSize += chunk.length
			})

			req.on('end',() => {
				if(data.charAt(0) == '"') data = data.substring(1,data.length);
				if(data.charAt(data.length-1) == '"') data = data.substring(0,data.length-1);
				console.log("Received data: '"+data+"'")
		    	console.log('No more data.')
		    	res.writeHead(200,{"Content-Type" : "application/json"});

		    	try {	
		    		var json = JSON.parse(data)
		    		if(checkInitialJSONStructure(json)) {
		    			try {
							json = json.content
						} catch(err) {
							res.end(JSON.stringify({"result":"failed","error":"Invalid JSON Structure"}))
						}

						if(checkContentJSONStructure(json)) {
							console.log("\n[+] checkContentJSONStructure passed.\n")
							functionToCall = getProperFunction(json.envelope)
							functionToCall(json.payload,function(data1) {
								var resultJSON = JSON.parse(data1.result)
								let resultJSONstring = JSON.stringify(resultJSON);
								res.end(resultJSONstring); 
							})	
						} else {
							res.end(JSON.stringify({"result":"failed","error":"Incorrect JSON Structure"}))
						}
		    		}	
		    	} catch(err) {
		    		console.log(err)
		    		res.end(JSON.stringify({"result":"failed","error":"Incorrect JSON Structure"}))
		    	}
			});
		});



process.argv.forEach(function (val,index,array) {
  if(val.indexOf("port") > -1) {
	  	var split = val.split("=");
	  	port = parseInt(split[1]);
  }
});

io = io.listen(s);	
s.listen(port,function(){
	console.log(`Worker ${process.pid} started sharing Interest Backend Server on port ${port}`);
});



