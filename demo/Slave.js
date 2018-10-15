/* SLAVE */
const fs             = require('fs');
const http           = require('http');
var redis            = require('redis')
var io               = require('socket.io')
var isJSON           = require('is-json')
var mysql_client     = require('./db_client_remake.js');
var aes              = require('./AES_Helper.js')
crypto_random_string = require('crypto-random-string')

port = 8082
const CIPHERKEY_LIFETIME     = 1  // in minutes
const DISPOSABLEKEY_LIFETIME = 1  // in minutes

var redisClient = redis.createClient();
var algorithm   = aes.CIPHERS.AES_128_CBC;
var cipher_key  = "TLW-28CZ@%7GcKsv";
var keyBuffer;
var local_set_time, global_set_time;

// {"userToken":"..","content":".."}
function checkInitialJSONStructure(json) {
	if(typeof(json.userToken) != "string" || typeof(json.content) != "string") 
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

function getDisposableKey(userToken,callback) {
	redisClient.get(userToken,function(err,res) {
		if(res) {
			callback({disposable_key: res}); 
		} else {
			callback({disposable_key : null});
		}
	});
}

function askCipherKeyToRedis() {
	redisClient.get("global_set_time",function(error,result) {
		if(result) {
			var temp_global_set_time = new Date(result)
			if(global_set_time === temp_global_set_time) setTimeout(askCipherKeyToRedis,0.2*1000) // 2 ms
			else {
				global_set_time = new Date(result); 
				redisClient.get("cipher_key",function(err,res) {
					if(res) {
						if(res != cipher_key) { // if the cipher key has been updated
							console.log("\n[REDIS] cipher_key = "+res);
							cipher_key = res;
							keyBuffer  = new Buffer(cipher_key)
							var temp   = new Date(global_set_time)
							temp.setMinutes(global_set_time.getMinutes+CIPHERKEY_LIFETIME)
							var now    = new Date(Date.now())
							var msDiff = temp-now;	
							setTimeout(askCipherKeyToRedis,msDiff/*+0.1*1000*/)
						} else setTimeout(askCipherKeyToRedis,0.2*1000)
					} else setTimeout(askCipherKeyToRedis,0.2*1000) 
				});
			}	
		} else setTimeout(askCipherKeyToRedis,0.2*1000)
	});
}

function concurrentRedisInsert(disposableKey,callback) { 
	let userToken = crypto_random_string(70)  
	redisClient.get(userToken,function(error,res) {
		if(res) {
			setTimeout(concurrentRedisInsert,2);
		} else {
			console.log("[*] Assigning the disposable_key '"+disposableKey+"' all'user token '"+userToken+"'")
			redisClient.setex(userToken,60*DISPOSABLEKEY_LIFETIME,disposableKey,function(error,result) {
				if(result.indexOf("OK") > -1) {
					callback({ createdUserToken : userToken });
				} else {
					setTimeout(concurrentRedisInsert,2);
				}
			});
		}
	});
}
	
function insertDisposableClientKey(callback) {
	let disposableKey = crypto_random_string(16)
	let disposableKeyBuffer = new Buffer(disposableKey)	
	
	concurrentRedisInsert(disposableKey,function(data) {
		callback({
			generatedDisposableKey : disposableKey,
			generatedUserToken : data.createdUserToken
		});	
	});
}	

function printLocalCipherKey() {
	console.log("Cipher key = "+cipher_key)
	setTimeout(printLocalCipherKey,30*1000)
}

/* {"userToken":"..","content":".."}\n\nIV  */
/* decrypted content: {"envelope":"..","payload":{..}} */
var s = http.createServer((req,res) => {
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
	    		// obtaining IV extracting the first 16 chars of the received message
	    		var iv = data.substring(0,16)
	    		data = data.substring(16,data.length)
	    		var ivBuffer  = new Buffer(iv);
	    		console.log("\nEncrypted data: '"+data+"'\n\n")
	    		console.log("Decryting using key='"+cipher_key+"' and IV='"+iv+"'..\n")
    			var plain_text = aes.decryptText(algorithm, keyBuffer, ivBuffer, data, "base64");
    			console.log("\nDecrypted data: "+plain_text+"\n"); 

    			var json = JSON.parse(plain_text)
    			if(checkInitialJSONStructure(json)) {
    				console.log("\n[+] checkInitialJSONStructure passed.\n")
    				getDisposableKey(json.userToken,function(data) {
    					var disposable_key = data.disposable_key;
    					console.log("[+] Disposable key found for user token '"+json.userToken+"' -> '"+disposable_key+"'")
    					var disposableKeyBuffer = new Buffer(disposable_key);

    					try {
    						var content = json.content
    						console.log("Encrypted content: "+content)
							plain_text = aes.decryptText(algorithm, disposableKeyBuffer, ivBuffer, content, "base64");
							console.log("Decrypted content: "+plain_text)

							try {
								json = JSON.parse(plain_text)
							} catch(err) {
								res.end(JSON.stringify({"result":"failed","error":"Invalid disposable key"}))
							}
							
			    			if(checkContentJSONStructure(json)) {
								console.log("\n[+] checkContentJSONStructure passed.\n")
								functionToCall = getProperFunction(json.envelope)
								functionToCall(json.payload,function(data1) {
									var resultJSON = JSON.parse(data1.result)
									insertDisposableClientKey(function(data2) {
										resultJSON["disposable_key"] = data2.generatedDisposableKey
										resultJSON["userToken"]  = data2.generatedUserToken
										resultJSON["cipher_key"] = cipher_key 
										let resultJSONstring = JSON.stringify(resultJSON);
										let enc_text = aes.encryptText(algorithm, disposableKeyBuffer, ivBuffer, resultJSONstring, "base64");
										console.log("Encrypting '"+resultJSONstring+"' using disposable_key="+disposable_key+" and IV="+iv+":\n"+enc_text);
										res.end(enc_text); 
									});
								})		
							} else {	
								console.log("Incorrect JSON Structure")
								res.end(JSON.stringify({"result":"failed","error":"Incorrect JSON Structure"}))
							} 
						} catch(err) {
							console.log(err)
							res.end(JSON.stringify({"result":"failed","error":"Invalid disposable key"}))
						}
					});
    			} else {
    				console.log("Incorrect JSON Structure")
					res.end(JSON.stringify({"result":"failed","error":"Incorrect JSON Structure"}))
    			}
    		} catch(err){
	    		console.log(err)
				res.end(JSON.stringify({"result":"failed","error":"No JSON data"})+'\n')
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
	console.log(`Worker ${process.pid} started Slave on port ${port}`);
});

askCipherKeyToRedis();



