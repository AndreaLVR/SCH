# -*- coding: utf-8 -*-
from AES import generate_random_string,encrypt,decrypt
import requests
import json
from base64 import b64decode
from base64 import b64encode
import warnings
import time
import threading
from threading_support import Barrier
import sys
warnings.filterwarnings("ignore")

analysis  = 15
attempts  = 10
success   = 0
times     = []
concurrent_threads = 1
barrier = Barrier(concurrent_threads+1)
slave_url = "https://localhost:8081"


# {"userToken":"..","content":"envelope":"..","payload":{..}}
def request(thread_id,s):
	global success

	for x in range(0,attempts):
		data = {"userToken":"1234567890","content":{"envelope":"function_one","payload":{"name":"Andrea"}}}
		r = requests.post(slave_url, data=json.dumps(data), verify=False)
		#print "\nResponse:\n\n'%s'\n" %r.text
		if("Hello Andrea" in r.text):
			success += 1

	barrier.wait()

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


analysis = int(sys.argv[1])
attempts = int(sys.argv[2])

for k in range(0,analysis):
	barrier = Barrier(concurrent_threads+1)

	start_time = time.time()
	for i in range(0,concurrent_threads):
		thread = threading.Thread(target=request, args=(i,None))
		thread.start()

	barrier.wait()
	end_time = time.time() 
	elapsed_time = end_time-start_time
	times.append(elapsed_time)
	print "%s" %k


#print times

print "\n\nSuccess: %s\n" %success
print "Average time: %s\n" %media(times)
print "Varianza: %s" %variance(times)

