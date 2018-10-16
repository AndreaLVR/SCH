# -*- coding: utf-8 -*-
from AES import generate_random_string,encrypt,decrypt
import requests
import json
from base64 import b64decode
from base64 import b64encode
import warnings
import time
import threading
import certifi
from threading_support import Barrier
import sys
warnings.filterwarnings("ignore")

logs = []
#log_file = open("/media/shared/FSH/fsh.log","w")
master_url = "https://192.168.1.140:8090"
slave_url  = "http://192.168.1.140:8081"

def requestkey_to_master(thread_id):
	data = {'username':'Thread0','password':'Pass0'}
	data_json = json.dumps(data)
	r = requests.post(master_url, data=data_json, verify=False)
	#print "\nMaster response:\n\n'%s'\n" %r.text
	return json.loads(r.text.strip())

def request_to_slave(thread_id,userToken,cipher_key,disposable_key,function_name):
	# {"userToken":"..","content":".."}\n\nIV  
	# decrypted content: {"envelope":"..","payload":{..}} 
	content = {'envelope':function_name,'payload':{'name':'Thread %s' %thread_id}}
	content_json_str = json.dumps(content, separators=(',',':'))
	#print content_json_str
	content_enc,iv = encrypt(disposable_key,None,content_json_str)
	#print "\n%s\n" %content_enc 
	data = {'userToken':userToken,'content':content_enc}
	data_json_str = json.dumps(data, separators=(',',':'))
	#print data_json_str		
	data_enc,iv = encrypt(cipher_key,iv,data_json_str) 
	data_enc = "%s%s" %(iv,data_enc)
	#print "sending content:\n---\n%s\n---" %data_enc
	r = requests.post(slave_url, data=json.dumps(data_enc), verify=False)
	#print "\nSlave response:\n\n'%s'\n" %r.text
	return r.text,iv


'''def print_encryption_info(thread_id,userToken,cipher_key,disposable_key):
	#print "userToken: %s" %userToken
	#print "cipher_key: %s" %cipher_key
	#print "disposable_key: %s\n" %disposable_key
	#add_log(thread_id,"userToken: %s" %userToken)
	#add_log(thread_id,"cipher_key: %s" %cipher_key)
	#add_log(thread_id,"disposable_key: %s\n" %disposable_key)'''


def get_encryption_info(thread_id):
	response_json = requestkey_to_master(thread_id)
	userToken = response_json["userToken"].strip()
	cipher_key = response_json["result"]["cipher_key"].strip()
	disposable_key = response_json["disposable_key"].strip()
	#print_encryption_info(thread_id,userToken,cipher_key,disposable_key)
	return userToken,cipher_key,disposable_key


'''def report(attempts,success,logs,elapsed_time):
	print "\n[+] Elapsed_time: %s seconds" %elapsed_time
	print "[+] Attempts: %s" %attempts
	for i in range(0,len(success)):
		print "\n[+] Success of thread %s: %s" %(i,success[i])
		print "\n[+] Success percentage: %s\n\n" %(float(success[i])/attempts)

	for i in range(0,len(logs)):
		write_log(logs[i]+"\n")'''



def send_request(thread_id,success,userToken,cipher_key,disposable_key):
	response,iv = request_to_slave(thread_id,userToken,cipher_key,disposable_key,"function_one")
	#add_log(thread_id,"TRY sending request using: \n\tuserToken: %s\n\tcipher_key: %s\n\tdisposable_key: %s\n\tIV: %s" %(userToken,cipher_key,disposable_key,iv))
	#add_log(thread_id,"response = %s" %response)
	decrypted = decrypt(disposable_key,iv,response)
	#add_log(thread_id,"response decrypted: %s" %(decrypted))
	#print decrypted
	response_json = json.loads(decrypted.strip())	
	result = response_json["result"].strip()
	userToken = response_json["userToken"].strip()
	cipher_key = response_json["cipher_key"].strip()
	disposable_key = response_json["disposable_key"].strip()
	#print "\n\n--------\n"
	#print "result: %s\n" %result
	#add_log(thread_id,"result: %s\n" %result)
	#print_encryption_info(thread_id,userToken,cipher_key,disposable_key)
	#print "--------\n"
	return userToken,cipher_key,disposable_key


def add_log(thread_id,s):
	logs[thread_id] = "%s\n%s" %(logs[thread_id],s)


def write_log(s):
	#print s
	log_file.write(s)

def media(times):
	average_time = 0.0
	for time in times:
		average_time += time
	average_time = float(average_time)/len(times)
	return average_time

def variance(times):
	medium = media(times)
	numeratore = 0
	for time in times:
		numeratore += (time-medium)*(time-medium)
	return float(numeratore)/len(times)



success  = []
concurrent_threads = 1
max_attempts = 10
barrier = Barrier(concurrent_threads+1) 
analysis = 15
times = []


def thread_execution(thread_id,success):
	userToken,cipher_key,disposable_key = get_encryption_info(thread_id)
	for i in range(0,max_attempts):		
		try:
			userToken,cipher_key,disposable_key = send_request(thread_id,success,userToken,cipher_key,disposable_key)
			success[thread_id] += 1
			#add_log(thread_id,"SUCCESS!")
			#time.sleep(0.5)
		except Exception as e:
			#add_log(thread_id,"First exception: %s" %e)
			#print "[*] Contacting Master Server for a new cipher_key"
			#add_log(thread_id,"[*] Contacting Master Server for new cipher_key")
			userToken,cipher_key,disposable_key = get_encryption_info(thread_id)
			try:
				#add_log(thread_id,"RETRY sending request..")
				userToken,cipher_key,disposable_key = send_request(thread_id,success,userToken,cipher_key,disposable_key)
				success[thread_id] += 1 
				#add_log(thread_id,"SUCCESS!")
			except Exception as e:	
				#add_log(thread_id,"[ERROR] FAILED --> %s" %e)
				userToken,cipher_key,disposable_key = get_encryption_info(thread_id)

	barrier.wait()


analysis = int(sys.argv[1])
max_attempts = int(sys.argv[2])

for i in range(0,concurrent_threads):
	success.append(0)
	logs.append("\n\n\nTHREAD %s\n" %i)

for x in range(0,analysis):
	barrier = Barrier(concurrent_threads+1)

	start_time = time.time()
	for i in range(0,concurrent_threads):
		thread = threading.Thread(target=thread_execution, args=(i,success))
		thread.start()

	barrier.wait()
	end_time = time.time() 
	elapsed_time = end_time-start_time
	times.append(elapsed_time)
	print "%s" %x
	#report(max_attempts,success,logs,end_time-start_time)

#log_file.close()

print times

print "\n\nAverage time: %s\n" %media(times)
print "Varianza: %s" %variance(times)


