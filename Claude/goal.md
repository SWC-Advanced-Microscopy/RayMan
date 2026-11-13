# RayMan Goal

I want to make a web-based piece of software that will allow me to do manual ray-tracing in lectures in the way described in these demos:
https://optics.mouse.vision/demos/ray-optics/ray-tracing/#1

This is a tool for during the lecture. It's also a tool for the students to practice. 
It's not supposed to "do it for you". You will place lenses and draw rays. 
But it will help by making sure lines are straight, snapping ideal lenses to the optical axis, placing markers at +/- f
Allowing you to change focal lengths so the markers move. 

It should handle simple cases like a single lens that focuses collimated light. 

All the way up to something like a 4f system for a scanning microscope such as this demo series shows:
https://optics.mouse.vision/demos/scanning-microscopy/confocal-from-zero/#1


## How I want to work.
I envisage something along these lines
1. Canvas that has a grid and an optical axis. 
2. A tool strip. I click on a lens. place it on the optical axis to which it snaps. 
3. I can move it along the optical axis. 
4. When highlighted there is a properties panel that allows me to alter f (+/-). All lenses are thin ideal lenses.
5. Say I want to trace a ray from infinity. I click a little over to the left from the lens and a line is drawn. It snaps to the lens. I move it up and down until happy and click to place. If line is parallel to optical axis the optical axis should be highlighted so I know I have placed it parallel to that. 
6. Then I want to go through f on the other side. I click on the node of the line I just drew and move my mouse cursor such that the line intersects with +f. the +f is highlighted to show it passes through. I click and the line is made. 
7. Similar process with a ray through the centre of the lens that is undeviated. The lens centre highlights to show I have hit it. 


## other stuff
The three principle rays have the colour codes you saw in the demos above. The software would be smart enough to know which ray they are and optionally colour-code them if I ask. 


## To begin with
I want to be able to place an "object" (the traditional arrow head) and trace off that. 
Build an image. Use that image as an object for another lens. Have the software automatically make the new object/image when the ray tracing is complete. 


