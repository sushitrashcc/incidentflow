variable "region" {
  description = "AWS region (AWS Academy Learner Lab uses us-east-1)"
  type        = string
  default     = "us-east-1"
}

variable "project" {
  description = "Name prefix for every resource"
  type        = string
  default     = "incidentflow"
}

variable "instance_type" {
  description = "EC2 size; t3.medium (2 vCPU, 4 GB) runs Jenkins and the app together"
  type        = string
  default     = "t3.medium"
}

variable "root_volume_gb" {
  description = "Root EBS volume size in GB"
  type        = number
  default     = 20
}

variable "ssh_ingress_cidrs" {
  description = "CIDR blocks allowed to SSH (Ansible). Narrow this to your own IP for better security."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "jenkins_ingress_cidrs" {
  description = "CIDR blocks allowed to reach the Jenkins UI on port 8080"
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "availability_zone" {
  description = "AZ for the server; us-east-1e does not offer t3 instance types"
  type        = string
  default     = "us-east-1a"
}
