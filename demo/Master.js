/* MASTER */
fs                   = require('fs')
https                = require('https')
io                   = require('socket.io')
aes                  = require('./AES_Helper.js')
redis                = require('redis')
crypto_random_string = require('crypto-random-string')
//mysql_client         = require('./db_client_remake.js')

port = 8090 
const CIPHERKEY_LIFETIME        = 1    // in minutes
const DISPOSABLEKEY_LIFETIME    = 0.4  // in minutes
const USERTOKEN_LIFETIME        = 10   // in minutes
var algorithm   = aes.CIPHERS.AES_128_CBC;
var cipher_key  = ""                   // it changes every CIPHERKEY_LIFETIME minutes	
var redisClient = redis.createClient();
var global_set_time;


function checkJSONStructure(json) {
	return (typeof(json.password) == "string" && typeof(json.username) == "string") 
}

function tryEscape(val) {
	if(val != undefined) return mysql_client.escape(val);
	return null;
}

function insertRecentToken(username) {
	redisClient.setex(username,60*USERTOKEN_LIFETIME,"valid");
}

function askRecentTokenToRedis(username,callback) {
	let valid = false;
	redisClient.get(username,function(error,result) {
		callback({
			validUser : (result=="valid")
		});
	});
}

function concurrentRedisInsert(disposableKey,callback) { 
	let userToken = crypto_random_string(70)  

	redisClient.get(userToken,function(error,res) {
		if(res) {
			setTimeout(concurrentRedisInsert(disposableKey,callback),2);
		} else {
			console.log("[*] Assegno la disposable_key '"+disposableKey+"' all'user token '"+userToken+"'")
			redisClient.setex(userToken,60*DISPOSABLEKEY_LIFETIME,disposableKey,function(error,result) {
				if(result.indexOf("OK") > -1) {
					callback({ createdUserToken : userToken });		
				} else {
					setTimeout(concurrentRedisInsert(disposableKey,callback),2);
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

function checkCredentials(json,callback) {
	/*askRecentTokenToRedis(json.username,function(data) {
		if(data.validUser) {
			console.log("[REDIS] Valid user.")
			callback({validUser: true}); 
		} else {
			mysql_client.checkUserQuery(json,function(data) {	
				if(data.validUser) {	
					console.log("[DB] Valid user.");
					insertRecentToken(json.username);
					callback({validUser: true}); 
				} else {
					callback({validUser:false}) 
				}
			});
		}
	});*/
	callback({validUser:true});
}


function trustUserAndProceed(username,callback) {
	insertDisposableClientKey(function(data) {
		json = '{"result":{"cipher_key":"'+cipher_key+'"},"error":"none","disposable_key":"'+data.generatedDisposableKey+'","userToken":"'+data.generatedUserToken+'"}';
		callback({ response_json : json });
	})		
}

function updateCipherKey() { 
	cipher_key = crypto_random_string(16)
	//console.log("setting global_set_time -> "+new Date(Date.now()))
	redisClient.setex("global_set_time",60*CIPHERKEY_LIFETIME,new Date(Date.now()));	
	redisClient.setex("cipher_key",60*CIPHERKEY_LIFETIME,cipher_key);  
	console.log("\nnew Cipher Key = "+cipher_key);	
	setTimeout(updateCipherKey,60*CIPHERKEY_LIFETIME*1000); // ogni CIPHERKEY_LIFETIME minuti
}


var sslOptions = {
	key: fs.readFileSync('/root/ca/requests/webserverok_key.pem'),
	cert: fs.readFileSync('/root/ca/requests/webserverok_cert.pem'),
	passphrase: 'blackjack'
};

var s=https.createServer(sslOptions, (req,res) => {
	console.log("Request: "+req.method+" URL: "+req.url)
	var data = ''
	req.setEncoding('utf8') // if an encoding is not set, Buffer objects are received

	req.on('data', (chunk) => {
   	 	console.log(`Received ${chunk.length} bytes of data. Type ${chunk.constructor.name}`)
     	data += chunk;
	})
	
	req.on('end',() => {
		console.log("Received data: "+data)
    	console.log('No more data.')

    	try{	
			var json = JSON.parse(data) // {"username":"..","password":".."}
			res.writeHead(200,{"Content-Type" : "application/json"})
			if(checkJSONStructure(json)) {
				console.log("\n[+] checkJSONStructure passed.\n")	
				checkCredentials(json,function(data1) {
					if(data1.validUser) {	
						trustUserAndProceed(json.username,function(data2) {
							res.end(data2.response_json);
						});		
					} else {
						res.end(JSON.stringify({"result":"error","error":"Invalid username/password"}));
					}
				});		
			} else {
				console.log("Incorrect JSON Structure")
				res.end(JSON.stringify({"result":"error","error":"Incorrect JSON Structure"}))
			}	
    	} catch(err){
    		console.log("Incorrect JSON Structure") 
			res.writeHead(400,{"Content-Type" : "application/json"})
			res.end(JSON.stringify({"result":"error","error":err.message}))
    	}
	})
});

process.argv.forEach(function (val,index,array) {
  if(val.indexOf("port") > -1) {
	  	var split = val.split("=");
	  	port = parseInt(split[1]);
  }
});

io = io.listen(s);	
s.listen(port,function(){
	console.log(`\nWorker ${process.pid} started Authorization Server on port ${port}\n`);
	updateCipherKey();
});	

